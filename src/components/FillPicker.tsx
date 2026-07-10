// Solid color / gradient picker used for shape fills, text color and the page
// background. The gradient tab edits a GradientSpec: presets, linear/radial,
// angle, and per-stop color + opacity (opacity 0 = fades to transparent).

import { useState } from 'react';
import { anyToHex } from '../editor/colors';
import {
  DEFAULT_GRADIENT, GRADIENT_PRESETS, gradientToSpec, specToCss,
  type GradientSpec, type GradientStop,
} from '../editor/gradients';
import { ColorPicker } from './ColorPicker';
import { Icon } from './icons';

interface FillPickerProps {
  /** current fill — a hex string or a fabric gradient */
  fill: unknown;
  onSolid: (hex: string, final: boolean) => void;
  onGradient: (spec: GradientSpec, final: boolean) => void;
}

export function FillPicker({ fill, onSolid, onGradient }: FillPickerProps) {
  const initialSpec = gradientToSpec(fill);
  const [tab, setTab] = useState<'solid' | 'gradient'>(initialSpec ? 'gradient' : 'solid');
  return (
    <div className="fill-picker">
      <div className="fill-tabs dl-scopes">
        <button className={`chip${tab === 'solid' ? ' active' : ''}`} onClick={() => setTab('solid')}>Solid</button>
        <button className={`chip${tab === 'gradient' ? ' active' : ''}`} onClick={() => setTab('gradient')}>Gradient</button>
      </div>
      {tab === 'solid' ? (
        <ColorPicker value={anyToHex(fill) ?? '#8b3dff'} onChange={onSolid} />
      ) : (
        <GradientEditor initial={initialSpec ?? undefined} onChange={onGradient} />
      )}
    </div>
  );
}

const CHECKER = 'repeating-conic-gradient(#e2e5e9 0% 25%, #ffffff 0% 50%)';

function GradientEditor({ initial, onChange }: {
  initial?: GradientSpec;
  onChange: (spec: GradientSpec, final: boolean) => void;
}) {
  const [spec, setSpec] = useState<GradientSpec>(() =>
    initial ?? { ...DEFAULT_GRADIENT, stops: DEFAULT_GRADIENT.stops.map((s) => ({ ...s })) });
  const [sel, setSel] = useState(0);
  const selIdx = Math.min(sel, spec.stops.length - 1);
  const stop = spec.stops[selIdx];

  const apply = (next: GradientSpec, final = true) => {
    setSpec(next);
    onChange(next, final);
  };
  const patchStop = (patch: Partial<GradientStop>, final = true) => {
    apply({ ...spec, stops: spec.stops.map((s, i) => (i === selIdx ? { ...s, ...patch } : s)) }, final);
  };
  const addStop = () => {
    const sorted = [...spec.stops].sort((a, b) => a.offset - b.offset);
    const pos = sorted.indexOf(stop);
    const next = sorted[pos + 1] ?? sorted[pos - 1] ?? stop;
    const offset = next === stop
      ? Math.min(1, stop.offset + 0.25)
      : (stop.offset + next.offset) / 2;
    apply({ ...spec, stops: [...spec.stops, { color: stop.color, opacity: stop.opacity, offset }] });
    setSel(spec.stops.length);
  };
  const removeStop = () => {
    if (spec.stops.length <= 2) return;
    apply({ ...spec, stops: spec.stops.filter((_, i) => i !== selIdx) });
    setSel(0);
  };

  return (
    <div className="gradient-editor">
      <div
        className="grad-preview"
        style={{ backgroundImage: `${specToCss(spec)}, ${CHECKER}`, backgroundSize: 'auto, 14px 14px' }}
      />
      <div className="cp-label">Presets</div>
      <div className="grad-presets">
        {GRADIENT_PRESETS.map((p, i) => (
          <button
            key={i}
            className="grad-swatch"
            style={{ backgroundImage: `${specToCss(p)}, ${CHECKER}`, backgroundSize: 'auto, 10px 10px' }}
            title="Apply this gradient"
            onClick={() => {
              setSel(0);
              apply({ ...p, stops: p.stops.map((s) => ({ ...s })) });
            }}
          />
        ))}
      </div>
      <div className="dl-scopes" style={{ margin: '10px 0 2px' }}>
        <button className={`chip${spec.kind === 'linear' ? ' active' : ''}`} onClick={() => apply({ ...spec, kind: 'linear' })}>Linear</button>
        <button className={`chip${spec.kind === 'radial' ? ' active' : ''}`} onClick={() => apply({ ...spec, kind: 'radial' })}>Radial</button>
      </div>
      {spec.kind === 'linear' && (
        <>
          <div className="slider-row"><span>Angle</span><span>{spec.angle}°</span></div>
          <input
            className="slider" type="range" min={0} max={360} step={5}
            value={spec.angle}
            onChange={(e) => apply({ ...spec, angle: +e.target.value }, false)}
            onPointerUp={() => onChange(spec, true)}
          />
        </>
      )}
      <div className="cp-label" style={{ marginTop: 10 }}>Color stops — tap one to edit it</div>
      <div
        className="grad-track"
        style={{
          backgroundImage: `${specToCss({ ...spec, kind: 'linear', angle: 90 })}, ${CHECKER}`,
          backgroundSize: 'auto, 12px 12px',
        }}
      >
        {spec.stops.map((s, i) => (
          <button
            key={i}
            className={`grad-pin${i === selIdx ? ' active' : ''}`}
            style={{ left: `${s.offset * 100}%`, background: s.color, opacity: 0.35 + s.opacity * 0.65 }}
            onClick={() => setSel(i)}
            aria-label={`Color stop ${i + 1}`}
          />
        ))}
      </div>
      <div className="grad-row">
        <button className="btn-secondary" onClick={addStop}><Icon name="plus" size={14} />Add stop</button>
        <button className="btn-secondary" disabled={spec.stops.length <= 2} onClick={removeStop}><Icon name="trash" size={14} />Remove</button>
      </div>
      <div className="slider-row"><span>Stop position</span><span>{Math.round(stop.offset * 100)}%</span></div>
      <input
        className="slider" type="range" min={0} max={100}
        value={Math.round(stop.offset * 100)}
        onChange={(e) => patchStop({ offset: +e.target.value / 100 }, false)}
        onPointerUp={() => onChange(spec, true)}
      />
      <div className="slider-row"><span>Stop opacity</span><span>{Math.round(stop.opacity * 100)}%</span></div>
      <input
        className="slider" type="range" min={0} max={100}
        value={Math.round(stop.opacity * 100)}
        onChange={(e) => patchStop({ opacity: +e.target.value / 100 }, false)}
        onPointerUp={() => onChange(spec, true)}
      />
      <div className="hint" style={{ margin: '2px 0 8px' }}>
        Opacity 0% fades this end to fully transparent — e.g. orange → soft clear.
      </div>
      <ColorPicker value={stop.color} onChange={(hex, final) => patchStop({ color: hex }, final)} />
    </div>
  );
}
