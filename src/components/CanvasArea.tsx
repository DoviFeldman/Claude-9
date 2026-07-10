import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { editor } from '../editor/Editor';
import { useEditor } from '../editor/useEditor';
import { importFiles } from '../editor/importers';
import { exportProject, openProjectDialog } from '../editor/project';
import { Icon } from './icons';
import { CropOverlay } from './CropOverlay';

/** Zoom so the document point under (clientX, clientY) stays put on screen. */
function zoomAtPoint(el: HTMLDivElement, next: number, clientX: number, clientY: number): void {
  const old = editor.zoom;
  if (next === old) return;

  // anchor on the page-frame nearest the cursor (single column -> by Y);
  // measuring the same element before and after the zoom render makes the
  // correction exact despite fixed-size chrome (padding, page headers)
  const frames = Array.from(el.querySelectorAll<HTMLElement>('.page-frame'));
  const anchor = frames.length
    ? frames.reduce((best, f) => {
        const r = f.getBoundingClientRect();
        const d = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
        return d < best.d ? { f, d } : best;
      }, { f: frames[0], d: Infinity }).f
    : null;
  if (!anchor) { editor.setZoom(next); return; }

  // cursor position in unzoomed document coordinates, relative to that page
  const r0 = anchor.getBoundingClientRect();
  const docX = (clientX - r0.left) / old;
  const docY = (clientY - r0.top) / old;

  // apply zoom with a synchronous React render so layout is final
  flushSync(() => editor.setZoom(next));

  // re-measure and scroll so that doc point is back under the cursor
  const r1 = anchor.getBoundingClientRect();
  el.scrollLeft += r1.left + docX * next - clientX;
  el.scrollTop += r1.top + docY * next - clientY;
}

function PageCanvas({ pageId }: { pageId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    editor.attachCanvas(pageId, ref.current);
    return () => editor.detachCanvas(pageId);
  }, [pageId]);

  return <canvas ref={ref} />;
}

function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export function CanvasArea() {
  const version = useEditor();
  const scrollRef = useRef<HTMLDivElement>(null);
  const spaceDown = useRef(false);

  // after every committed layout change, refresh fabric's cached element offsets
  useEffect(() => {
    const id = requestAnimationFrame(() => editor.recalcOffsets());
    return () => cancelAnimationFrame(id);
  }, [version]);

  // observe viewport size for fit-zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      editor.containerSize = { w: el.clientWidth, h: el.clientHeight };
      if (editor.zoomMode === 'fit') editor.zoomToFit();
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ctrl+wheel zoom centered on cursor
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // zoom proportionally to the scroll delta so trackpads (many small
      // events per gesture) feel as controlled as discrete mouse notches
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= 100;
      dy = Math.max(-120, Math.min(120, dy));
      const next = Math.min(4, Math.max(0.05, editor.zoom * Math.exp(-dy * 0.0007)));
      zoomAtPoint(el, next, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // two-finger pinch zoom + pan (touch devices). Captured on the container so
  // fabric never sees the second finger and starts a drag with it.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let start: { d: number; z: number } | null = null;
    let lastMid = { x: 0, y: 0 };
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      editor.activeCanvas?.discardActiveObject();
      editor.activeCanvas?.requestRenderAll();
      start = { d: dist(e.touches), z: editor.zoom };
      lastMid = mid(e.touches);
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length < 2) return;
      e.preventDefault();
      e.stopPropagation();
      const m = mid(e.touches);
      el.scrollLeft -= m.x - lastMid.x;
      el.scrollTop -= m.y - lastMid.y;
      lastMid = m;
      const next = Math.min(4, Math.max(0.05, start.z * (dist(e.touches) / start.d)));
      zoomAtPoint(el, next, m.x, m.y);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) start = null;
    };
    el.addEventListener('touchstart', onStart, { capture: true, passive: false });
    el.addEventListener('touchmove', onMove, { capture: true, passive: false });
    el.addEventListener('touchend', onEnd, true);
    el.addEventListener('touchcancel', onEnd, true);
    return () => {
      el.removeEventListener('touchstart', onStart, true);
      el.removeEventListener('touchmove', onMove, true);
      el.removeEventListener('touchend', onEnd, true);
      el.removeEventListener('touchcancel', onEnd, true);
    };
  }, []);

  // pan with space+drag or middle mouse
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let panning = false;
    let last = { x: 0, y: 0 };

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target) && !editorIsEditingText()) {
        spaceDown.current = e.type === 'keydown';
        el.classList.toggle('panning', spaceDown.current);
        if (e.type === 'keydown') e.preventDefault();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (e.button === 1 || (spaceDown.current && e.button === 0)) {
        panning = true;
        last = { x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!panning) return;
      el.scrollLeft -= e.clientX - last.x;
      el.scrollTop -= e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => { panning = false; };

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    };
  }, []);

  // global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || editorIsEditingText()) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); void editor.undo(); }
      else if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); void editor.redo(); }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); void editor.duplicateSelected(); }
      else if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); editor.groupSelection(); }
      else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); editor.selectAll(); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void exportProject(); }
      else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openProjectDialog(); }
      else if (mod && e.key.toLowerCase() === 'c') { void editor.copySelection(); }
      else if (mod && e.key.toLowerCase() === 'x') { void editor.copySelection().then(() => editor.deleteSelected()); }
      else if (mod && e.key.toLowerCase() === 'v') { void editor.pasteClipboard(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editor.getActiveObject()) { e.preventDefault(); editor.deleteSelected(); }
      } else if (e.key === 'Escape') {
        if (editor.crop) editor.cancelCrop();
        else if (editor.tool === 'draw') editor.setPanelTab(null);
        else {
          editor.activeCanvas?.discardActiveObject();
          editor.activeCanvas?.requestRenderAll();
          editor.notify();
        }
      } else if (e.key.startsWith('Arrow')) {
        const obj = editor.getActiveObject();
        if (!obj) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        obj.set({ left: (obj.left ?? 0) + dx, top: (obj.top ?? 0) + dy });
        obj.setCoords();
        editor.activeCanvas?.requestRenderAll();
        editor.commitActive();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // drag & drop + paste import
  useEffect(() => {
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.files.length) void importFiles(e.dataTransfer.files);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target) || editorIsEditingText()) return;
      const files = e.clipboardData?.files;
      if (files?.length) void importFiles(files);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  const { docW, docH, zoom, pages } = editor;

  return (
    <div
      className="canvas-scroll"
      ref={scrollRef}
      onScroll={() => editor.recalcOffsets()}
      onPointerDown={(e) => {
        // clicking the gray backdrop clears the selection
        if ((e.target as HTMLElement).classList.contains('canvas-scroll')
          || (e.target as HTMLElement).classList.contains('pages-column')) {
          editor.activeCanvas?.discardActiveObject();
          editor.activeCanvas?.requestRenderAll();
          editor.notify();
        }
      }}
    >
      <div className="pages-column">
        {pages.map((p, i) => (
          <div className="page-block" key={p.id} style={{ width: docW * zoom }}>
            <div className={`page-header${editor.activePageId === p.id ? ' active' : ''}`}>
              <span className="page-title" onClick={() => editor.setActivePage(p.id)}>
                Page {i + 1} of {pages.length}
              </span>
              <span className="page-actions">
                <button className="icon-btn small" title="Move page up" disabled={i === 0} onClick={() => editor.movePage(p.id, -1)}><Icon name="up" size={14} /></button>
                <button className="icon-btn small" title="Move page down" disabled={i === pages.length - 1} onClick={() => editor.movePage(p.id, 1)}><Icon name="down" size={14} /></button>
                <button className="icon-btn small" title="Duplicate page" onClick={() => editor.duplicatePage(p.id)}><Icon name="duplicate" size={14} /></button>
                <button className="icon-btn small" title="Add page below" onClick={() => editor.addPage(i)}><Icon name="plus" size={14} /></button>
                <button className="icon-btn small" title="Delete page" onClick={() => editor.deletePage(p.id)}><Icon name="trash" size={14} /></button>
              </span>
            </div>
            <div
              className={`page-frame${editor.activePageId === p.id ? ' active' : ''}`}
              style={{ width: docW * zoom, height: docH * zoom }}
            >
              <PageCanvas pageId={p.id} />
              {editor.crop && editor.crop.pageId === p.id && <CropOverlay />}
            </div>
          </div>
        ))}
        <button className="add-page-btn" onClick={() => editor.addPage()}>
          <Icon name="plus" size={16} /> Add page
        </button>
      </div>
    </div>
  );
}

function editorIsEditingText(): boolean {
  const obj = editor.getActiveObject() as any;
  return !!obj && obj.isEditing === true;
}
