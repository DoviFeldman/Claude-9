import { useEffect, useRef, useState } from 'react';
import { editor } from '../editor/Editor';
import { useEditor } from '../editor/useEditor';

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

/**
 * Crop UI drawn over the selected image in its own (possibly rotated) frame.
 * Coordinates are kept in rendered-object local units; Editor.applyCrop maps
 * them back to source pixels (handling flips) and bakes the crop permanently.
 */
export function CropOverlay() {
  useEditor();
  const crop = editor.crop;
  const [rect, setRect] = useState(() => {
    const img = crop!.object;
    return { x: 0, y: 0, w: img.width ?? 100, h: img.height ?? 100 };
  });
  const dragRef = useRef<{
    handle: HandleId;
    startX: number;
    startY: number;
    start: { x: number; y: number; w: number; h: number };
  } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !editor.crop) return;
      const img = editor.crop.object;
      const zoom = editor.zoom;
      const scaleX = (img.scaleX ?? 1) * zoom;
      const scaleY = (img.scaleY ?? 1) * zoom;
      const angle = ((img.angle ?? 0) * Math.PI) / 180;
      // rotate the screen delta into the image frame, then to local units
      const dxs = e.clientX - d.startX;
      const dys = e.clientY - d.startY;
      const dx = (dxs * Math.cos(angle) + dys * Math.sin(angle)) / scaleX;
      const dy = (-dxs * Math.sin(angle) + dys * Math.cos(angle)) / scaleY;
      const W = img.width ?? 100;
      const H = img.height ?? 100;
      const min = 12;
      let { x, y, w, h } = d.start;
      const hd = d.handle;
      if (hd === 'move') {
        x = Math.min(Math.max(0, x + dx), W - w);
        y = Math.min(Math.max(0, y + dy), H - h);
      } else {
        if (hd.includes('w')) { const nx = Math.min(Math.max(0, x + dx), x + w - min); w += x - nx; x = nx; }
        if (hd.includes('e')) { w = Math.min(Math.max(min, w + dx), W - x); }
        if (hd.includes('n')) { const ny = Math.min(Math.max(0, y + dy), y + h - min); h += y - ny; y = ny; }
        if (hd.includes('s')) { h = Math.min(Math.max(min, h + dy), H - y); }
      }
      setRect({ x, y, w, h });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  if (!crop) return null;
  const img = crop.object;
  const zoom = editor.zoom;
  const scaleX = (img.scaleX ?? 1) * zoom;
  const scaleY = (img.scaleY ?? 1) * zoom;
  const coords = img.calcACoords();
  // top-left corner of the rotated image in page coordinates
  const left = coords.tl.x * zoom;
  const top = coords.tl.y * zoom;
  const W = (img.width ?? 100) * scaleX;
  const H = (img.height ?? 100) * scaleY;

  const start = (handle: HandleId) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { handle, startX: e.clientX, startY: e.clientY, start: { ...rect } };
  };

  const px = (v: number) => `${v}px`;
  const handles: { id: HandleId; x: number; y: number; cursor: string }[] = [
    { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
    { id: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
    { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
    { id: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
    { id: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
    { id: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
    { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
    { id: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
  ];

  return (
    <div
      className="crop-overlay"
      style={{
        left: px(left),
        top: px(top),
        width: px(W),
        height: px(H),
        transform: `rotate(${img.angle ?? 0}deg)`,
        transformOrigin: 'left top',
      }}
    >
      <div
        className="crop-window"
        style={{
          left: px(rect.x * scaleX),
          top: px(rect.y * scaleY),
          width: px(rect.w * scaleX),
          height: px(rect.h * scaleY),
        }}
        onPointerDown={start('move')}
      >
        <div className="crop-thirds" />
        {handles.map((h) => (
          <div
            key={h.id}
            className={`crop-handle ${h.id}`}
            style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, cursor: h.cursor }}
            onPointerDown={start(h.id)}
          />
        ))}
      </div>
      <div className="crop-actions" style={{ transform: `rotate(${-(img.angle ?? 0)}deg)` }}>
        <button className="btn-secondary" onClick={() => editor.cancelCrop()}>Cancel</button>
        <button className="btn-primary" onClick={() => void editor.applyCrop(rect)}>Apply crop</button>
      </div>
    </div>
  );
}
