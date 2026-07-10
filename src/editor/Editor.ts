// The Editor singleton owns the document (pages of fabric canvases), zoom,
// tools, selection, history and autosave. React components subscribe to it
// via useEditor() and re-render when `version` bumps.

import * as fabric from 'fabric';
import { hexWithAlpha } from './colors';
import { saveDoc, type SavedDoc } from './db';
import { ensureFont } from './fonts';
import { gradientToSpec, isGradient, specToGradient, type GradientSpec } from './gradients';
import { roundedTrianglePath } from './shapes';

export { ensureFont } from './fonts';

export const EXTRA_PROPS = [
  'shapeKind', 'cornerRadius', 'palette', 'locked', 'triW', 'triH',
  'lockMovementX', 'lockMovementY', 'lockRotation', 'lockScalingX', 'lockScalingY', 'editable',
];

let uidCounter = 0;
export const newId = () => `p${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

export type ToolMode = 'select' | 'draw';
export type PanelTab = 'design' | 'elements' | 'text' | 'uploads' | 'draw' | null;
export interface PageEntry { id: string }

export type ShapeKind = 'rect' | 'square' | 'circle' | 'ellipse' | 'triangle' | 'line' | 'line-dashed' | 'line-dotted';

const SELECTION_STYLE = {
  transparentCorners: false,
  cornerColor: '#ffffff',
  cornerStrokeColor: '#b8bfc9',
  cornerStyle: 'circle' as const,
  cornerSize: 11,
  touchCornerSize: 22,
  borderColor: '#8b3dff',
  borderScaleFactor: 1.6,
  borderOpacityWhenMoving: 0.6,
};

export function decorate(obj: fabric.FabricObject): void {
  obj.set(SELECTION_STYLE);
  // rotation snapping: magnetic near multiples of 15°, free otherwise
  obj.snapAngle = 15;
  obj.snapThreshold = 4;
  if (obj instanceof fabric.Path) obj.perPixelTargetFind = true;
}

export function sceneBBox(obj: fabric.FabricObject): { left: number; top: number; width: number; height: number } {
  const c = obj.calcACoords();
  const xs = [c.tl.x, c.tr.x, c.bl.x, c.br.x];
  const ys = [c.tl.y, c.tr.y, c.bl.y, c.br.y];
  const left = Math.min(...xs), top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

export const isTextObject = (o: fabric.FabricObject): o is fabric.IText =>
  o instanceof fabric.IText || o instanceof fabric.Textbox || (o as any).type === 'text';

export interface CropState {
  pageId: string;
  object: fabric.FabricImage;
}

type Listener = () => void;

class Editor {
  docName = 'Untitled design';
  docW = 1280;
  docH = 720;
  pages: PageEntry[] = [{ id: newId() }];
  activePageId: string = this.pages[0].id;

  zoom = 1;
  zoomMode: 'fit' | 'manual' = 'fit';
  tool: ToolMode = 'select';
  panelTab: PanelTab = 'design';
  brush = { color: '#1a1a1a', size: 6, opacity: 1 };

  crop: CropState | null = null;

  pendingPdf: File | null = null; // triggers the PDF import-mode dialog
  uploadsVersion = 0;

  version = 0;
  busyMessage: string | null = null;

  private canvases = new Map<string, fabric.Canvas>();
  private pendingJSON = new Map<string, string>();
  private canvasWaiters = new Map<string, ((c: fabric.Canvas) => void)[]>();
  private listeners = new Set<Listener>();

  private undoStack: { pageId: string; json: string }[] = [];
  private redoStack: { pageId: string; json: string }[] = [];
  private snapshots = new Map<string, string>();
  private squelch = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private snapGuides = new Map<string, { v: number[]; h: number[] }>();
  private snapCache: { target: fabric.FabricObject; xs: number[]; ys: number[] } | null = null;

  clipboard: fabric.FabricObject | null = null;
  containerSize = { w: 1200, h: 800 };

  // ---------- subscription ----------
  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;
  notify(): void {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  setBusy(msg: string | null): void {
    this.busyMessage = msg;
    this.notify();
  }

  // ---------- canvas lifecycle ----------
  attachCanvas(pageId: string, el: HTMLCanvasElement): fabric.Canvas {
    const canvas = new fabric.Canvas(el, {
      preserveObjectStacking: true,
      backgroundColor: '#ffffff',
      selectionColor: 'rgba(139,61,255,0.08)',
      selectionBorderColor: '#8b3dff',
      selectionLineWidth: 1.5,
      stopContextMenu: true,
      fireRightClick: false,
      // touch: dragging an object moves it, dragging empty canvas scrolls the page
      allowTouchScrolling: true,
    });
    canvas.setDimensions({ width: this.docW * this.zoom, height: this.docH * this.zoom });
    canvas.setZoom(this.zoom);
    this.canvases.set(pageId, canvas);
    this.wireEvents(pageId, canvas);
    this.applyToolTo(canvas);

    const pending = this.pendingJSON.get(pageId);
    if (pending) {
      this.pendingJSON.delete(pageId);
      void this.loadPageJSON(canvas, pending).then(() => {
        this.snapshots.set(pageId, pending);
        this.resolveWaiters(pageId, canvas);
        this.notify();
      });
    } else {
      this.snapshots.set(pageId, this.serializePage(canvas));
      this.resolveWaiters(pageId, canvas);
    }
    return canvas;
  }

  private resolveWaiters(pageId: string, canvas: fabric.Canvas): void {
    const ws = this.canvasWaiters.get(pageId);
    if (ws) {
      this.canvasWaiters.delete(pageId);
      ws.forEach((w) => w(canvas));
    }
  }

  detachCanvas(pageId: string): void {
    const canvas = this.canvases.get(pageId);
    if (canvas) {
      this.canvases.delete(pageId);
      void canvas.dispose();
    }
  }

  getCanvas(pageId: string): fabric.Canvas | undefined {
    return this.canvases.get(pageId);
  }
  get activeCanvas(): fabric.Canvas | undefined {
    return this.canvases.get(this.activePageId);
  }

  waitForCanvas(pageId: string): Promise<fabric.Canvas> {
    const existing = this.canvases.get(pageId);
    if (existing && !this.pendingJSON.has(pageId)) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const arr = this.canvasWaiters.get(pageId) ?? [];
      arr.push(resolve);
      this.canvasWaiters.set(pageId, arr);
    });
  }

  private wireEvents(pageId: string, canvas: fabric.Canvas): void {
    const commitSoon = () => this.commit(pageId);
    canvas.on('object:added', (e) => {
      if (e.target) decorate(e.target);
      commitSoon();
    });
    canvas.on('object:removed', commitSoon);
    canvas.on('object:modified', (opt) => {
      this.snapGuides.delete(pageId);
      this.snapCache = null;
      // Defer one tick: fabric is still finishing its own mouse-up bookkeeping
      // for this object, and the rescue may move it to another canvas.
      // Committing afterwards keeps the whole drop a single undo entry.
      const target = opt.target;
      setTimeout(() => {
        if (!target || !this.rescueDroppedObject(pageId, canvas, target)) this.commit(pageId);
      }, 0);
    });
    canvas.on('selection:created', () => this.onSelection(pageId));
    canvas.on('selection:updated', () => this.onSelection(pageId));
    canvas.on('selection:cleared', () => this.notify());
    canvas.on('text:editing:exited', commitSoon);
    canvas.on('mouse:down', () => {
      this.setActivePage(pageId);
    });
    canvas.on('object:moving', (opt) =>
      this.applySnapping(pageId, canvas, opt.target, !!(opt.e as MouseEvent | undefined)?.ctrlKey));
    canvas.on('mouse:up', () => {
      this.snapCache = null;
      if (this.snapGuides.delete(pageId)) canvas.requestRenderAll();
    });
    canvas.on('after:render', ({ ctx }) => this.drawGuides(pageId, canvas, ctx));
  }

  private onSelection(pageId: string): void {
    // only one page can hold a selection at a time
    for (const [id, c] of this.canvases) {
      if (id !== pageId && c.getActiveObject()) {
        c.discardActiveObject();
        c.requestRenderAll();
      }
    }
    this.setActivePage(pageId);
    this.notify();
  }

  /** Sample the rendered pixel color under a pointer event on any page canvas. */
  samplePixelFromEvent(e: { target: EventTarget | null; clientX: number; clientY: number }): string | null {
    try {
      for (const c of this.canvases.values()) {
        const upper = (c as unknown as { upperCanvasEl: HTMLCanvasElement }).upperCanvasEl;
        if (upper !== e.target) continue;
        const rect = upper.getBoundingClientRect();
        const lower = c.lowerCanvasEl;
        const x = Math.round((e.clientX - rect.left) * (lower.width / rect.width));
        const y = Math.round((e.clientY - rect.top) * (lower.height / rect.height));
        const ctx = lower.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        const d = ctx.getImageData(x, y, 1, 1).data;
        return `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ---------- snapping ----------
  /**
   * Snap the moving selection to the page (edges, center) and to every other
   * object on the page (edges and centers, both axes). The candidate lines are
   * cached for the duration of a drag. Hold Ctrl to move freely.
   */
  private applySnapping(pageId: string, canvas: fabric.Canvas, target: fabric.FabricObject, bypass = false): void {
    if (!target) return;
    if (bypass) {
      if (this.snapGuides.delete(pageId)) canvas.requestRenderAll();
      return;
    }
    if (!this.snapCache || this.snapCache.target !== target) {
      const xs = [0, this.docW / 2, this.docW];
      const ys = [0, this.docH / 2, this.docH];
      const skip = new Set<fabric.FabricObject>(canvas.getActiveObjects());
      skip.add(target);
      for (const o of canvas.getObjects()) {
        if (skip.has(o) || o.visible === false) continue;
        const b = sceneBBox(o);
        xs.push(b.left, b.left + b.width / 2, b.left + b.width);
        ys.push(b.top, b.top + b.height / 2, b.top + b.height);
      }
      this.snapCache = { target, xs, ys };
    }
    const { xs, ys } = this.snapCache;
    const tol = 6 / this.zoom;
    const box = sceneBBox(target);
    const refX = [box.left, box.left + box.width / 2, box.left + box.width];
    const refY = [box.top, box.top + box.height / 2, box.top + box.height];
    let dx = 0, dy = 0, bestX = Infinity, bestY = Infinity;
    for (const at of xs) {
      for (const ref of refX) {
        const d = Math.abs(at - ref);
        if (d < tol && d < bestX) { bestX = d; dx = at - ref; }
      }
    }
    for (const at of ys) {
      for (const ref of refY) {
        const d = Math.abs(at - ref);
        if (d < tol && d < bestY) { bestY = d; dy = at - ref; }
      }
    }
    if (dx !== 0 || dy !== 0) {
      target.set({ left: target.left! + dx, top: target.top! + dy });
      target.setCoords();
    }
    // draw every candidate line the snapped position now sits on
    const v: number[] = [];
    const h: number[] = [];
    if (bestX < Infinity) {
      for (const at of xs) {
        if (refX.some((ref) => Math.abs(at - (ref + dx)) < 0.5) && !v.some((x) => Math.abs(x - at) < 0.5)) v.push(at);
      }
    }
    if (bestY < Infinity) {
      for (const at of ys) {
        if (refY.some((ref) => Math.abs(at - (ref + dy)) < 0.5) && !h.some((y) => Math.abs(y - at) < 0.5)) h.push(at);
      }
    }
    if (v.length || h.length) this.snapGuides.set(pageId, { v: v.slice(0, 4), h: h.slice(0, 4) });
    else this.snapGuides.delete(pageId);
  }

  private drawGuides(pageId: string, canvas: fabric.Canvas, ctx: CanvasRenderingContext2D): void {
    const g = this.snapGuides.get(pageId);
    if (!g) return;
    const r = canvas.getRetinaScaling();
    const vpt = canvas.viewportTransform!;
    ctx.save();
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 1 / this.zoom;
    ctx.setLineDash([6 / this.zoom, 4 / this.zoom]);
    for (const x of g.v) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.docH); ctx.stroke(); }
    for (const y of g.h) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.docW, y); ctx.stroke(); }
    ctx.restore();
  }

  // ---------- cross-page drag ----------
  /**
   * Called when a drag ends with the selection fully outside the page. If it
   * was dropped over another page, move it there (like dragging between pages
   * in Canva); otherwise pull it back so it can never be lost off-canvas.
   * Returns true when the object was transferred (commits handled inside).
   */
  private rescueDroppedObject(pageId: string, canvas: fabric.Canvas, target: fabric.FabricObject): boolean {
    const box = sceneBBox(target);
    const fullyOutside =
      box.left + box.width < 0 || box.left > this.docW ||
      box.top + box.height < 0 || box.top > this.docH;
    if (!fullyOutside) return false;

    const upper = (canvas as unknown as { upperCanvasEl?: HTMLCanvasElement }).upperCanvasEl;
    const rect = upper?.getBoundingClientRect();
    if (rect && rect.width > 0) {
      const scale = rect.width / this.docW;
      const cx = rect.left + (box.left + box.width / 2) * scale;
      const cy = rect.top + (box.top + box.height / 2) * scale;
      for (const p of this.pages) {
        if (p.id === pageId) continue;
        const other = this.canvases.get(p.id);
        const el = (other as unknown as { upperCanvasEl?: HTMLCanvasElement } | undefined)?.upperCanvasEl;
        if (!other || !el) continue;
        const r = el.getBoundingClientRect();
        if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
          this.transferSelection(pageId, p.id, target);
          return true;
        }
      }
    }
    // nothing under it — bring it back into view on its own page
    const m = Math.max(8, Math.min(40, box.width / 2, box.height / 2));
    let dx = 0, dy = 0;
    if (box.left + box.width < m) dx = m - (box.left + box.width);
    else if (box.left > this.docW - m) dx = this.docW - m - box.left;
    if (box.top + box.height < m) dy = m - (box.top + box.height);
    else if (box.top > this.docH - m) dy = this.docH - m - box.top;
    if (dx !== 0 || dy !== 0) {
      target.set({ left: (target.left ?? 0) + dx, top: (target.top ?? 0) + dy });
      target.setCoords();
      canvas.requestRenderAll();
    }
    return false;
  }

  /** Move the dragged object/selection from one page to another, keeping its
   *  on-screen position (both pages share doc coordinates + zoom). */
  private transferSelection(fromId: string, toId: string, target: fabric.FabricObject): void {
    const from = this.canvases.get(fromId);
    const to = this.canvases.get(toId);
    const fromEl = (from as unknown as { upperCanvasEl?: HTMLCanvasElement } | undefined)?.upperCanvasEl;
    const toEl = (to as unknown as { upperCanvasEl?: HTMLCanvasElement } | undefined)?.upperCanvasEl;
    if (!from || !to || !fromEl || !toEl) return;
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    const scale = fromRect.width / this.docW;
    const dx = (fromRect.left - toRect.left) / scale;
    const dy = (fromRect.top - toRect.top) / scale;
    const list = target instanceof fabric.ActiveSelection ? [...target.getObjects()] : [target];
    this.squelch++;
    try {
      from.discardActiveObject(); // restores absolute coords on selection members
      for (const o of list) {
        from.remove(o);
        o.set({ left: (o.left ?? 0) + dx, top: (o.top ?? 0) + dy });
        o.setCoords();
        decorate(o);
        to.add(o);
      }
      if (list.length === 1) {
        to.setActiveObject(list[0]);
      } else if (list.length > 1) {
        const sel = new fabric.ActiveSelection(list, { canvas: to });
        decorate(sel);
        to.setActiveObject(sel);
      }
      from.requestRenderAll();
      to.requestRenderAll();
    } finally {
      this.squelch--;
    }
    this.commit(fromId);
    this.commit(toId);
    this.setActivePage(toId);
  }

  // ---------- serialization / history ----------
  serializePage(canvas: fabric.Canvas | fabric.StaticCanvas): string {
    return JSON.stringify(canvas.toObject(EXTRA_PROPS));
  }

  async loadPageJSON(canvas: fabric.Canvas, json: string): Promise<void> {
    this.squelch++;
    try {
      await canvas.loadFromJSON(JSON.parse(json));
      canvas.getObjects().forEach(decorate);
      const fams = new Set<string>();
      canvas.getObjects().forEach((o) => {
        if (isTextObject(o) && (o as any).fontFamily) fams.add((o as any).fontFamily);
      });
      void Promise.all([...fams].map(ensureFont)).then(() => canvas.requestRenderAll());
      canvas.requestRenderAll();
    } finally {
      this.squelch--;
    }
  }

  commit(pageId: string): void {
    if (this.squelch > 0) return;
    const canvas = this.canvases.get(pageId);
    if (!canvas) return;
    const json = this.serializePage(canvas);
    const prev = this.snapshots.get(pageId);
    if (prev === json) return;
    if (prev !== undefined) {
      this.undoStack.push({ pageId, json: prev });
      if (this.undoStack.length > 60) this.undoStack.shift();
      this.redoStack = [];
    }
    this.snapshots.set(pageId, json);
    this.scheduleSave();
    this.notify();
  }

  commitActive(): void {
    this.commit(this.activePageId);
  }

  /** Run a multi-step mutation as a single undo entry. */
  async batch<T>(fn: () => T | Promise<T>, pageId = this.activePageId): Promise<T> {
    this.squelch++;
    try {
      return await fn();
    } finally {
      this.squelch--;
      this.commit(pageId);
    }
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  async undo(): Promise<void> {
    const entry = this.undoStack.pop();
    if (!entry) return;
    const canvas = this.canvases.get(entry.pageId);
    const current = this.snapshots.get(entry.pageId);
    if (!canvas || current === undefined) return;
    this.redoStack.push({ pageId: entry.pageId, json: current });
    this.snapshots.set(entry.pageId, entry.json);
    await this.loadPageJSON(canvas, entry.json);
    this.scheduleSave();
    this.notify();
  }

  async redo(): Promise<void> {
    const entry = this.redoStack.pop();
    if (!entry) return;
    const canvas = this.canvases.get(entry.pageId);
    const current = this.snapshots.get(entry.pageId);
    if (!canvas || current === undefined) return;
    this.undoStack.push({ pageId: entry.pageId, json: current });
    this.snapshots.set(entry.pageId, entry.json);
    await this.loadPageJSON(canvas, entry.json);
    this.scheduleSave();
    this.notify();
  }

  // ---------- persistence ----------
  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), 1200);
  }

  async saveNow(): Promise<void> {
    const pages = this.pages.map((p) => {
      const c = this.canvases.get(p.id);
      if (c) return this.serializePage(c);
      return this.pendingJSON.get(p.id) ?? this.snapshots.get(p.id) ?? '{"objects":[]}';
    });
    await saveDoc({ name: this.docName, docW: this.docW, docH: this.docH, pages });
  }

  hydrate(doc: SavedDoc): void {
    this.docName = doc.name;
    this.docW = doc.docW;
    this.docH = doc.docH;
    this.pages = doc.pages.map(() => ({ id: newId() }));
    if (this.pages.length === 0) this.pages = [{ id: newId() }];
    doc.pages.forEach((json, i) => this.pendingJSON.set(this.pages[i].id, json));
    this.activePageId = this.pages[0].id;
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  newDocument(w?: number, h?: number): void {
    for (const id of [...this.canvases.keys()]) {
      const c = this.canvases.get(id);
      c?.discardActiveObject();
    }
    this.docName = 'Untitled design';
    if (w && h) { this.docW = w; this.docH = h; }
    this.pages = [{ id: newId() }];
    this.activePageId = this.pages[0].id;
    this.pendingJSON.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.snapshots.clear();
    this.zoomMode = 'fit';
    this.scheduleSave();
    this.notify();
  }

  /** true if the doc is a single empty page (safe to replace size on import) */
  isFresh(): boolean {
    if (this.pages.length !== 1) return false;
    const c = this.canvases.get(this.pages[0].id);
    return !c || c.getObjects().length === 0;
  }

  setDocName(name: string): void {
    this.docName = name;
    this.scheduleSave();
    this.notify();
  }

  setDocSize(w: number, h: number): void {
    this.docW = Math.max(16, Math.min(8000, Math.round(w)));
    this.docH = Math.max(16, Math.min(8000, Math.round(h)));
    // background gradients are sized in pixels — rebuild them for the new size
    for (const c of this.canvases.values()) {
      if (isGradient(c.backgroundColor)) {
        const spec = gradientToSpec(c.backgroundColor);
        if (spec) c.backgroundColor = specToGradient(spec, { units: 'pixels', w: this.docW, h: this.docH });
      }
    }
    this.applyZoomToCanvases();
    this.zoomMode = 'fit';
    this.zoomToFit();
    this.scheduleSave();
    this.notify();
  }

  // ---------- zoom ----------
  setZoom(z: number, manual = true): void {
    this.zoom = Math.min(4, Math.max(0.05, z));
    if (manual) this.zoomMode = 'manual';
    this.applyZoomToCanvases();
    this.notify();
  }

  zoomToFit(): void {
    const pad = 96;
    const z = Math.min(
      (this.containerSize.w - pad) / this.docW,
      (this.containerSize.h - pad) / this.docH,
    );
    this.zoom = Math.min(2.5, Math.max(0.05, z));
    this.zoomMode = 'fit';
    this.applyZoomToCanvases();
    this.notify();
  }

  private applyZoomToCanvases(): void {
    for (const c of this.canvases.values()) {
      c.setDimensions({ width: this.docW * this.zoom, height: this.docH * this.zoom });
      c.setZoom(this.zoom);
      c.calcOffset();
      c.requestRenderAll();
    }
  }

  /** Fabric caches element offsets; layout shifts (resize, scroll, page add) invalidate them. */
  recalcOffsets(): void {
    for (const c of this.canvases.values()) c.calcOffset();
  }

  // ---------- pages ----------
  setActivePage(id: string): void {
    if (this.activePageId !== id) {
      this.activePageId = id;
      this.notify();
    }
  }

  addPage(afterIndex?: number, json?: string, select = true): string {
    const entry = { id: newId() };
    const idx = afterIndex === undefined ? this.pages.length : afterIndex + 1;
    this.pages.splice(idx, 0, entry);
    if (json) this.pendingJSON.set(entry.id, json);
    if (select) this.activePageId = entry.id;
    this.scheduleSave();
    this.notify();
    return entry.id;
  }

  duplicatePage(id: string): void {
    const idx = this.pages.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const c = this.canvases.get(id);
    const json = c ? this.serializePage(c) : this.pendingJSON.get(id);
    this.addPage(idx, json);
  }

  deletePage(id: string): void {
    if (this.pages.length <= 1) {
      const c = this.canvases.get(id);
      if (c) {
        c.discardActiveObject();
        c.remove(...c.getObjects());
        c.backgroundColor = '#ffffff';
        c.requestRenderAll();
        this.commit(id);
      }
      return;
    }
    const idx = this.pages.findIndex((p) => p.id === id);
    if (idx < 0) return;
    this.pages.splice(idx, 1);
    this.pendingJSON.delete(id);
    this.snapshots.delete(id);
    this.undoStack = this.undoStack.filter((e) => e.pageId !== id);
    this.redoStack = this.redoStack.filter((e) => e.pageId !== id);
    if (this.activePageId === id) this.activePageId = this.pages[Math.max(0, idx - 1)].id;
    this.scheduleSave();
    this.notify();
  }

  movePage(id: string, dir: -1 | 1): void {
    const idx = this.pages.findIndex((p) => p.id === id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= this.pages.length) return;
    const [entry] = this.pages.splice(idx, 1);
    this.pages.splice(to, 0, entry);
    this.scheduleSave();
    this.notify();
  }

  // ---------- tools ----------
  setTool(tool: ToolMode): void {
    this.tool = tool;
    for (const c of this.canvases.values()) this.applyToolTo(c);
    this.notify();
  }

  setPanelTab(tab: PanelTab): void {
    this.panelTab = tab;
    this.setTool(tab === 'draw' ? 'draw' : 'select');
  }

  private applyToolTo(canvas: fabric.Canvas): void {
    if (this.tool === 'draw') {
      canvas.isDrawingMode = true;
      const brush = new fabric.PencilBrush(canvas);
      brush.color = hexWithAlpha(this.brush.color, this.brush.opacity);
      brush.width = this.brush.size;
      brush.decimate = 2;
      canvas.freeDrawingBrush = brush;
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    } else {
      canvas.isDrawingMode = false;
    }
  }

  setBrush(patch: Partial<{ color: string; size: number; opacity: number }>): void {
    Object.assign(this.brush, patch);
    for (const c of this.canvases.values()) {
      if (c.freeDrawingBrush) {
        c.freeDrawingBrush.color = hexWithAlpha(this.brush.color, this.brush.opacity);
        c.freeDrawingBrush.width = this.brush.size;
      }
    }
    this.notify();
  }

  // ---------- object creation ----------
  private baseSize(): number {
    return Math.round(Math.min(this.docW, this.docH) * 0.35);
  }

  private placeAndSelect(obj: fabric.FabricObject): void {
    const canvas = this.activeCanvas;
    if (!canvas) return;
    decorate(obj);
    const n = canvas.getObjects().length % 5;
    obj.setPositionByOrigin(
      new fabric.Point(this.docW / 2 + n * 12, this.docH / 2 + n * 12),
      'center', 'center',
    );
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
    this.setTool('select');
  }

  addShape(kind: ShapeKind): void {
    const s = this.baseSize();
    let obj: fabric.FabricObject;
    const fill = '#8b3dff';
    switch (kind) {
      case 'square':
        obj = new fabric.Rect({ width: s, height: s, fill, rx: 0, ry: 0 });
        (obj as any).shapeKind = 'rect';
        break;
      case 'rect':
        obj = new fabric.Rect({ width: s * 1.5, height: s, fill, rx: 0, ry: 0 });
        (obj as any).shapeKind = 'rect';
        break;
      case 'circle':
        obj = new fabric.Circle({ radius: s / 2, fill });
        (obj as any).shapeKind = 'circle';
        break;
      case 'ellipse':
        obj = new fabric.Ellipse({ rx: s * 0.75, ry: s / 2, fill });
        (obj as any).shapeKind = 'ellipse';
        break;
      case 'triangle': {
        obj = new fabric.Path(roundedTrianglePath(s * 1.15, s, 0), { fill });
        (obj as any).shapeKind = 'triangle';
        (obj as any).triW = s * 1.15;
        (obj as any).triH = s;
        (obj as any).cornerRadius = 0;
        break;
      }
      case 'line':
      case 'line-dashed':
      case 'line-dotted': {
        const len = Math.round(this.docW * 0.4);
        const line = new fabric.Line([0, 0, len, 0], {
          stroke: '#1a1a1a',
          strokeWidth: Math.max(3, Math.round(s / 40)),
          strokeLineCap: 'round',
        });
        if (kind === 'line-dashed') line.strokeDashArray = [line.strokeWidth * 3, line.strokeWidth * 2.5];
        if (kind === 'line-dotted') line.strokeDashArray = [0.1, line.strokeWidth * 2.2];
        (line as any).shapeKind = 'line';
        obj = line;
        break;
      }
    }
    this.placeAndSelect(obj);
  }

  async addText(preset: 'heading' | 'subheading' | 'body'): Promise<void> {
    const base = Math.min(this.docW, this.docH);
    const conf = {
      heading: { text: 'Add a heading', size: Math.round(base * 0.09), weight: 700 },
      subheading: { text: 'Add a subheading', size: Math.round(base * 0.055), weight: 600 },
      body: { text: 'Add a little bit of body text', size: Math.round(base * 0.032), weight: 400 },
    }[preset];
    await ensureFont('Inter');
    const tb = new fabric.Textbox(conf.text, {
      width: Math.round(this.docW * 0.6),
      fontSize: Math.max(10, conf.size),
      fontFamily: 'Inter',
      fontWeight: conf.weight,
      fill: '#1a1a1a',
      textAlign: 'center',
      lineHeight: 1.16,
    });
    this.placeAndSelect(tb);
  }

  async addImageFromDataURL(url: string, opts: { palette?: string[]; maxFraction?: number } = {}): Promise<fabric.FabricImage | null> {
    const canvas = this.activeCanvas;
    if (!canvas) return null;
    try {
      const img = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
      const frac = opts.maxFraction ?? 0.85;
      const scale = Math.min((this.docW * frac) / img.width!, (this.docH * frac) / img.height!, 1);
      img.scale(scale);
      if (opts.palette) (img as any).palette = opts.palette;
      this.placeAndSelect(img);
      return img;
    } catch {
      return null;
    }
  }

  async addSVGFromString(svgText: string): Promise<void> {
    const canvas = this.activeCanvas;
    if (!canvas) return;
    const parsed = await fabric.loadSVGFromString(svgText);
    const objects = parsed.objects.filter((o): o is fabric.FabricObject => !!o);
    if (objects.length === 0) return;
    const grouped = fabric.util.groupSVGElements(objects, parsed.options);
    const b = grouped.width && grouped.height ? grouped : null;
    const scale = b
      ? Math.min((this.docW * 0.7) / grouped.width!, (this.docH * 0.7) / grouped.height!, 1)
      : 1;
    grouped.scale(scale);
    this.placeAndSelect(grouped);
  }

  // ---------- selection ops ----------
  getActiveObject(): fabric.FabricObject | undefined {
    return this.activeCanvas?.getActiveObject() ?? undefined;
  }
  getActiveObjects(): fabric.FabricObject[] {
    return this.activeCanvas?.getActiveObjects() ?? [];
  }

  deleteSelected(): void {
    const canvas = this.activeCanvas;
    if (!canvas) return;
    const objs = canvas.getActiveObjects();
    if (!objs.length) return;
    void this.batch(() => {
      canvas.discardActiveObject();
      objs.forEach((o) => canvas.remove(o));
      canvas.requestRenderAll();
    });
  }

  async duplicateSelected(): Promise<void> {
    const canvas = this.activeCanvas;
    const active = canvas?.getActiveObject();
    if (!canvas || !active) return;
    const clone = await active.clone(EXTRA_PROPS as any);
    await this.batch(() => {
      canvas.discardActiveObject();
      clone.set({ left: (clone.left ?? 0) + 24, top: (clone.top ?? 0) + 24 });
      if (clone instanceof fabric.ActiveSelection) {
        clone.canvas = canvas;
        clone.forEachObject((o) => { decorate(o); canvas.add(o); });
        clone.setCoords();
        canvas.setActiveObject(clone);
      } else {
        decorate(clone);
        canvas.add(clone);
        canvas.setActiveObject(clone);
      }
      canvas.requestRenderAll();
    });
  }

  async copySelection(): Promise<void> {
    const active = this.getActiveObject();
    if (!active) return;
    this.clipboard = await active.clone(EXTRA_PROPS as any);
  }

  async pasteClipboard(): Promise<void> {
    const canvas = this.activeCanvas;
    if (!canvas || !this.clipboard) return;
    const clone = await this.clipboard.clone(EXTRA_PROPS as any);
    await this.batch(() => {
      canvas.discardActiveObject();
      clone.set({ left: (clone.left ?? 0) + 24, top: (clone.top ?? 0) + 24 });
      if (clone instanceof fabric.ActiveSelection) {
        clone.canvas = canvas;
        clone.forEachObject((o) => { decorate(o); canvas.add(o); });
        clone.setCoords();
        canvas.setActiveObject(clone);
      } else {
        decorate(clone);
        canvas.add(clone);
        canvas.setActiveObject(clone);
      }
      canvas.requestRenderAll();
    });
  }

  selectAll(): void {
    const canvas = this.activeCanvas;
    if (!canvas) return;
    canvas.discardActiveObject();
    const objs = canvas.getObjects().filter((o) => o.selectable !== false);
    if (!objs.length) return;
    const sel = new fabric.ActiveSelection(objs, { canvas });
    decorate(sel);
    canvas.setActiveObject(sel);
    canvas.requestRenderAll();
    this.notify();
  }

  groupSelection(): void {
    const canvas = this.activeCanvas;
    const active = canvas?.getActiveObject();
    if (!canvas || !active || !(active instanceof fabric.ActiveSelection)) return;
    void this.batch(() => {
      const objects = active.getObjects();
      canvas.discardActiveObject();
      objects.forEach((o) => canvas.remove(o));
      const group = new fabric.Group(objects);
      decorate(group);
      canvas.add(group);
      canvas.setActiveObject(group);
      canvas.requestRenderAll();
    });
  }

  ungroupSelection(): void {
    const canvas = this.activeCanvas;
    const active = canvas?.getActiveObject();
    if (!canvas || !active || !(active instanceof fabric.Group) || active instanceof fabric.ActiveSelection) return;
    void this.batch(() => {
      const idx = canvas.getObjects().indexOf(active);
      const items = active.removeAll() as fabric.FabricObject[];
      canvas.remove(active);
      items.forEach((o, i) => {
        decorate(o);
        canvas.insertAt(idx + i, o);
      });
      const sel = new fabric.ActiveSelection(items, { canvas });
      decorate(sel);
      canvas.setActiveObject(sel);
      canvas.requestRenderAll();
    });
  }

  layer(op: 'front' | 'back' | 'forward' | 'backward'): void {
    const canvas = this.activeCanvas;
    if (!canvas) return;
    const objs = canvas.getActiveObjects();
    objs.forEach((o) => {
      if (op === 'front') canvas.bringObjectToFront(o);
      else if (op === 'back') canvas.sendObjectToBack(o);
      else if (op === 'forward') canvas.bringObjectForward(o);
      else canvas.sendObjectBackwards(o);
    });
    canvas.requestRenderAll();
    this.commitActive();
  }

  alignToPage(how: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom'): void {
    const canvas = this.activeCanvas;
    const obj = canvas?.getActiveObject();
    if (!canvas || !obj) return;
    const box = sceneBBox(obj);
    let dx = 0, dy = 0;
    if (how === 'left') dx = -box.left;
    if (how === 'centerH') dx = this.docW / 2 - (box.left + box.width / 2);
    if (how === 'right') dx = this.docW - (box.left + box.width);
    if (how === 'top') dy = -box.top;
    if (how === 'centerV') dy = this.docH / 2 - (box.top + box.height / 2);
    if (how === 'bottom') dy = this.docH - (box.top + box.height);
    obj.set({ left: (obj.left ?? 0) + dx, top: (obj.top ?? 0) + dy });
    obj.setCoords();
    canvas.requestRenderAll();
    this.commitActive();
  }

  /** Apply properties to every object in the current selection. */
  setProps(props: Record<string, unknown>, commit = true): void {
    const canvas = this.activeCanvas;
    if (!canvas) return;
    const objs = canvas.getActiveObjects();
    if (!objs.length) return;
    objs.forEach((o) => {
      o.set(props);
      o.setCoords();
    });
    canvas.getActiveObject()?.setCoords();
    canvas.requestRenderAll();
    if (commit) this.commitActive();
    else this.notify();
  }

  /** Smart color set: fills shapes/text, strokes lines & drawn paths, recurses into groups. */
  setColor(hex: string, commit = true): void {
    const canvas = this.activeCanvas;
    if (!canvas) return;
    const objs = canvas.getActiveObjects();
    const applyDeep = (o: fabric.FabricObject): void => {
      if (o instanceof fabric.Group && !(o instanceof fabric.ActiveSelection)) {
        o.getObjects().forEach(applyDeep);
        o.dirty = true;
        return;
      }
      if (o instanceof fabric.Line || ((o as any).shapeKind === 'line')) o.set('stroke', hex);
      else if (o instanceof fabric.Path && !(o as any).shapeKind) o.set('stroke', hex); // free-drawn
      else if (o instanceof fabric.FabricImage) return;
      else o.set('fill', hex);
      o.dirty = true;
    };
    objs.forEach(applyDeep);
    canvas.requestRenderAll();
    if (commit) this.commitActive();
    else this.notify();
  }

  /** Apply a gradient to the selection: fills shapes/text, strokes lines &
   *  drawn paths, recurses into groups. Per-stop opacity → transparency fades. */
  setGradient(spec: GradientSpec, commit = true): void {
    const canvas = this.activeCanvas;
    if (!canvas) return;
    const objs = canvas.getActiveObjects();
    if (!objs.length) return;
    const applyDeep = (o: fabric.FabricObject): void => {
      if (o instanceof fabric.Group && !(o instanceof fabric.ActiveSelection)) {
        o.getObjects().forEach(applyDeep);
        o.dirty = true;
        return;
      }
      if (o instanceof fabric.FabricImage) return;
      const strokeTarget = o instanceof fabric.Line || (o as any).shapeKind === 'line'
        || (o instanceof fabric.Path && !(o as any).shapeKind);
      if (strokeTarget) {
        // stroke gradients need pixel coords over the object's local box
        o.set('stroke', specToGradient(spec, {
          units: 'pixels',
          w: Math.max(1, o.width ?? 1),
          h: Math.max(1, o.height ?? 1),
        }));
      } else {
        o.set('fill', specToGradient(spec));
      }
      o.dirty = true;
    };
    objs.forEach(applyDeep);
    canvas.requestRenderAll();
    if (commit) this.commitActive();
    else this.notify();
  }

  setPageGradient(spec: GradientSpec, commit = true): void {
    const canvas = this.activeCanvas;
    if (!canvas) return;
    // backgrounds are not scaled by fabric, so bake in the page size
    canvas.backgroundColor = specToGradient(spec, { units: 'pixels', w: this.docW, h: this.docH });
    canvas.requestRenderAll();
    if (commit) this.commitActive();
    else this.notify();
  }

  setCornerRadius(r: number, commit = true): void {
    const canvas = this.activeCanvas;
    if (!canvas) return;
    for (const o of canvas.getActiveObjects()) {
      const kind = (o as any).shapeKind;
      if (o instanceof fabric.Rect) {
        o.set({ rx: r, ry: r });
        (o as any).cornerRadius = r;
        o.dirty = true;
      } else if (kind === 'triangle' && o instanceof fabric.Path) {
        this.rebuildTriangle(canvas, o, r);
      }
    }
    canvas.requestRenderAll();
    if (commit) this.commitActive();
    else this.notify();
  }

  private rebuildTriangle(canvas: fabric.Canvas, old: fabric.Path, r: number): void {
    this.squelch++; // swap is one logical change; caller decides when to commit
    try {
      this.rebuildTriangleInner(canvas, old, r);
    } finally {
      this.squelch--;
    }
  }

  private rebuildTriangleInner(canvas: fabric.Canvas, old: fabric.Path, r: number): void {
    const w = (old as any).triW ?? old.width ?? 100;
    const h = (old as any).triH ?? old.height ?? 100;
    const center = old.getCenterPoint();
    const idx = canvas.getObjects().indexOf(old);
    const fresh = new fabric.Path(roundedTrianglePath(w, h, r), {
      fill: old.fill as string,
      stroke: old.stroke as string,
      strokeWidth: old.strokeWidth,
      strokeDashArray: old.strokeDashArray ?? undefined,
      opacity: old.opacity,
      angle: old.angle,
      scaleX: old.scaleX,
      scaleY: old.scaleY,
      flipX: old.flipX,
      flipY: old.flipY,
      shadow: old.shadow ?? undefined,
    });
    (fresh as any).shapeKind = 'triangle';
    (fresh as any).triW = w;
    (fresh as any).triH = h;
    (fresh as any).cornerRadius = r;
    decorate(fresh);
    const wasActive = canvas.getActiveObject() === old;
    canvas.remove(old);
    canvas.insertAt(Math.max(0, idx), fresh);
    fresh.setPositionByOrigin(center, 'center', 'center');
    fresh.setCoords();
    if (wasActive) canvas.setActiveObject(fresh);
  }

  toggleLock(): void {
    const objs = this.getActiveObjects();
    if (!objs.length) return;
    const lock = !(objs[0] as any).locked;
    objs.forEach((o) => {
      (o as any).locked = lock;
      o.set({
        lockMovementX: lock, lockMovementY: lock, lockRotation: lock,
        lockScalingX: lock, lockScalingY: lock,
        hasControls: !lock,
      });
      if (isTextObject(o)) (o as any).editable = !lock;
    });
    this.activeCanvas?.requestRenderAll();
    this.commitActive();
  }

  setPageBackground(hex: string, commit = true): void {
    const canvas = this.activeCanvas;
    if (!canvas) return;
    canvas.backgroundColor = hex;
    canvas.requestRenderAll();
    if (commit) this.commitActive();
    else this.notify();
  }

  // ---------- crop ----------
  beginCrop(): void {
    const obj = this.getActiveObject();
    if (obj instanceof fabric.FabricImage) {
      this.crop = { pageId: this.activePageId, object: obj };
      obj.set({ selectable: false, evented: false });
      this.activeCanvas?.discardActiveObject();
      this.activeCanvas?.requestRenderAll();
      this.notify();
    }
  }

  cancelCrop(): void {
    if (!this.crop) return;
    const { object, pageId } = this.crop;
    object.set({ selectable: true, evented: true });
    this.crop = null;
    const c = this.canvases.get(pageId);
    c?.setActiveObject(object);
    c?.requestRenderAll();
    this.notify();
  }

  /** rect is in rendered-object local units (same scale as object.width/height) */
  async applyCrop(rect: { x: number; y: number; w: number; h: number }): Promise<void> {
    if (!this.crop) return;
    const { object: img, pageId } = this.crop;
    const canvas = this.canvases.get(pageId);
    this.crop = null;
    img.set({ selectable: true, evented: true });
    if (!canvas) return;
    await this.batch(() => this.applyCropInner(rect, img, canvas), pageId);
  }

  private async applyCropInner(
    rect: { x: number; y: number; w: number; h: number },
    img: fabric.FabricImage,
    canvas: fabric.Canvas,
  ): Promise<void> {

    const W = img.width!, H = img.height!;
    const w = Math.max(4, Math.round(rect.w));
    const h = Math.max(4, Math.round(rect.h));
    // map rendered coords -> source coords (mirror when flipped)
    const sx = img.flipX ? W - rect.x - w : rect.x;
    const sy = img.flipY ? H - rect.y - h : rect.y;

    const el = img.getElement() as CanvasImageSource;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d')!.drawImage(el as HTMLImageElement, sx, sy, w, h, 0, 0, w, h);
    const url = out.toDataURL('image/png');

    // rendered-frame center of the crop -> unflipped object coords -> scene point
    const rx = rect.x + rect.w / 2 - W / 2;
    const ry = rect.y + rect.h / 2 - H / 2;
    const ox = img.flipX ? -rx : rx;
    const oy = img.flipY ? -ry : ry;
    const m = img.calcTransformMatrix();
    const centerScene = fabric.util.transformPoint(new fabric.Point(ox, oy), m);

    const fresh = await fabric.FabricImage.fromURL(url);
    fresh.set({
      scaleX: img.scaleX, scaleY: img.scaleY, angle: img.angle,
      flipX: img.flipX, flipY: img.flipY, opacity: img.opacity,
      shadow: img.shadow ?? undefined,
    });
    (fresh as any).palette = (img as any).palette;
    decorate(fresh);
    const idx = canvas.getObjects().indexOf(img);
    canvas.remove(img);
    canvas.insertAt(Math.max(0, idx), fresh);
    fresh.setPositionByOrigin(centerScene, 'center', 'center');
    fresh.setCoords();
    canvas.setActiveObject(fresh);
    canvas.requestRenderAll();
  }

  /** Replace every pixel near `fromHex` with `toHex` in the selected image (permanent). */
  async replaceColorInImage(fromHex: string, toHex: string, tolerance: number): Promise<boolean> {
    const img = this.getActiveObject();
    if (!(img instanceof fabric.FabricImage)) return false;
    const canvas = this.activeCanvas;
    const el = img.getElement() as HTMLImageElement | HTMLCanvasElement;
    const W = img.width!, H = img.height!;
    const work = document.createElement('canvas');
    work.width = W; work.height = H;
    const ctx = work.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(el, 0, 0, W, H);
    let data: ImageData;
    try {
      data = ctx.getImageData(0, 0, W, H);
    } catch {
      return false;
    }
    const from = fromHex.replace('#', '');
    const to = toHex.replace('#', '');
    const fr = parseInt(from.slice(0, 2), 16), fg = parseInt(from.slice(2, 4), 16), fb = parseInt(from.slice(4, 6), 16);
    const tr = parseInt(to.slice(0, 2), 16), tg = parseInt(to.slice(2, 4), 16), tb = parseInt(to.slice(4, 6), 16);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.hypot(d[i] - fr, d[i + 1] - fg, d[i + 2] - fb) <= tolerance) {
        d[i] = tr; d[i + 1] = tg; d[i + 2] = tb;
      }
    }
    ctx.putImageData(data, 0, 0);
    await img.setSrc(work.toDataURL('image/png'));
    img.dirty = true;
    canvas?.requestRenderAll();
    this.commitActive();
    return true;
  }

  flipSelected(axis: 'x' | 'y'): void {
    const objs = this.getActiveObjects();
    objs.forEach((o) => o.set(axis === 'x' ? { flipX: !o.flipX } : { flipY: !o.flipY }));
    this.activeCanvas?.requestRenderAll();
    this.commitActive();
  }
}

export const editor = new Editor();
