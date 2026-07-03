import { useEffect, useRef } from 'react';
import { editor } from '../editor/Editor';
import { useEditor } from '../editor/useEditor';
import { importFiles } from '../editor/importers';
import { Icon } from './icons';
import { CropOverlay } from './CropOverlay';

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
      const old = editor.zoom;
      const next = Math.min(4, Math.max(0.05, old * Math.exp(-dy * 0.0007)));
      if (next === old) return;
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = next / old;
      const sl = el.scrollLeft, st = el.scrollTop;
      editor.setZoom(next);
      el.scrollLeft = (sl + cx) * factor - cx;
      el.scrollTop = (st + cy) * factor - cy;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
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
