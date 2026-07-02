import { useEffect, useMemo, useRef, useState } from 'react';
import * as fabric from 'fabric';
import { DEFAULT_SWATCHES } from '../constants';
import { anyToHex, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, clamp } from '../editor/colors';
import { editor } from '../editor/Editor';
import { Icon } from './icons';

interface ColorPickerProps {
  value: string;
  /** final=false while dragging, true when the change should be committed */
  onChange: (hex: string, final: boolean) => void;
}

function documentColors(): string[] {
  const out = new Set<string>();
  for (const page of editor.pages) {
    const c = editor.getCanvas(page.id);
    if (!c) continue;
    const walk = (objs: fabric.FabricObject[]) => {
      for (const o of objs) {
        const f = anyToHex((o as any).fill);
        const s = anyToHex((o as any).stroke);
        if (f) out.add(f);
        if (s) out.add(s);
        if (o instanceof fabric.Group) walk(o.getObjects());
      }
    };
    walk(c.getObjects());
    const bg = anyToHex(c.backgroundColor);
    if (bg) out.add(bg);
  }
  return [...out].slice(0, 14);
}

function photoColors(): string[] {
  const out: string[] = [];
  const active = editor.getActiveObject();
  const push = (p?: string[]) => p?.forEach((hex) => { if (!out.includes(hex)) out.push(hex); });
  if (active && (active as any).palette) push((active as any).palette);
  for (const page of editor.pages) {
    const c = editor.getCanvas(page.id);
    c?.getObjects().forEach((o) => push((o as any).palette));
  }
  return out.slice(0, 14);
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const rgb = hexToRgb(value) ?? { r: 139, g: 61, b: 255 };
  const [hsv, setHsv] = useState(() => rgbToHsv(rgb.r, rgb.g, rgb.b));
  const [hexField, setHexField] = useState(value);
  const svRef = useRef<HTMLDivElement>(null);
  const external = useRef(value);

  useEffect(() => {
    if (value !== external.current) {
      external.current = value;
      const r = hexToRgb(value);
      if (r) setHsv(rgbToHsv(r.r, r.g, r.b));
      setHexField(value);
    }
  }, [value]);

  const docCols = useMemo(documentColors, []);
  const imgCols = useMemo(photoColors, []);

  const emit = (h: number, s: number, v: number, final: boolean) => {
    const { r, g, b } = hsvToRgb(h, s, v);
    const hex = rgbToHex(r, g, b);
    external.current = hex;
    setHexField(hex);
    onChange(hex, final);
  };

  const handleSV = (e: React.PointerEvent) => {
    const el = svRef.current!;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent | React.PointerEvent, final: boolean) => {
      const rect = el.getBoundingClientRect();
      const s = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
      const v = clamp(1 - (ev.clientY - rect.top) / rect.height, 0, 1);
      setHsv((prev) => {
        emit(prev.h, s, v, final);
        return { ...prev, s, v };
      });
    };
    move(e, false);
    const onMove = (ev: PointerEvent) => move(ev, false);
    const onUp = (ev: PointerEvent) => {
      move(ev, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const hueBg = 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)';
  const pureHue = (() => { const { r, g, b } = hsvToRgb(hsv.h, 1, 1); return rgbToHex(r, g, b); })();

  const swatchRow = (label: string, colors: string[]) =>
    colors.length > 0 && (
      <div className="cp-section" key={label}>
        <div className="cp-label">{label}</div>
        <div className="cp-swatches">
          {colors.map((c) => (
            <button
              key={c}
              className={`cp-swatch${c.toLowerCase() === value.toLowerCase() ? ' active' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() => {
                external.current = c;
                const r = hexToRgb(c);
                if (r) setHsv(rgbToHsv(r.r, r.g, r.b));
                setHexField(c);
                onChange(c, true);
              }}
            />
          ))}
        </div>
      </div>
    );

  return (
    <div className="color-picker">
      <div
        ref={svRef}
        className="cp-sv"
        style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,${pureHue})` }}
        onPointerDown={handleSV}
      >
        <div
          className="cp-sv-cursor"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }}
        />
      </div>
      <input
        className="cp-hue"
        type="range"
        min={0}
        max={360}
        step={1}
        value={hsv.h}
        style={{ background: hueBg }}
        onChange={(e) => {
          const h = +e.target.value;
          setHsv((prev) => { emit(h, prev.s, prev.v, false); return { ...prev, h }; });
        }}
        onPointerUp={() => emit(hsv.h, hsv.s, hsv.v, true)}
      />
      <div className="cp-hex-row">
        <input
          className="cp-hex"
          value={hexField}
          spellCheck={false}
          onChange={(e) => setHexField(e.target.value)}
          onBlur={() => {
            const hex = anyToHex(hexField.startsWith('#') ? hexField : `#${hexField}`);
            if (hex) {
              const r = hexToRgb(hex)!;
              setHsv(rgbToHsv(r.r, r.g, r.b));
              external.current = hex;
              onChange(hex, true);
            } else setHexField(value);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {'EyeDropper' in window && (
          <button
            className="icon-btn"
            title="Pick a color from the screen"
            onClick={async () => {
              try {
                const result = await new (window as any).EyeDropper().open();
                const hex = anyToHex(result.sRGBHex);
                if (hex) {
                  const r = hexToRgb(hex)!;
                  setHsv(rgbToHsv(r.r, r.g, r.b));
                  setHexField(hex);
                  external.current = hex;
                  onChange(hex, true);
                }
              } catch { /* cancelled */ }
            }}
          >
            <Icon name="eyedropper" size={18} />
          </button>
        )}
      </div>
      {swatchRow('Photo colors', imgCols)}
      {swatchRow('Document colors', docCols)}
      {swatchRow('Default colors', DEFAULT_SWATCHES)}
    </div>
  );
}

/** Small round chip used in toolbars to open a color popover. */
export function ColorChip({ color }: { color: string }) {
  return <span className="color-chip" style={{ background: color }} />;
}
