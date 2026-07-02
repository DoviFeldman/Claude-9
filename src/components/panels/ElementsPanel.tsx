import { editor, type ShapeKind } from '../../editor/Editor';

const SHAPES: { kind: ShapeKind; label: string; svg: JSX.Element }[] = [
  { kind: 'square', label: 'Square', svg: <rect x="6" y="6" width="36" height="36" /> },
  { kind: 'rect', label: 'Rectangle', svg: <rect x="3" y="12" width="42" height="24" /> },
  { kind: 'circle', label: 'Circle', svg: <circle cx="24" cy="24" r="19" /> },
  { kind: 'ellipse', label: 'Oval', svg: <ellipse cx="24" cy="24" rx="20" ry="13" /> },
  { kind: 'triangle', label: 'Triangle', svg: <path d="M24 6L44 42H4z" /> },
];

const LINES: { kind: ShapeKind; label: string; dash?: string }[] = [
  { kind: 'line', label: 'Line' },
  { kind: 'line-dashed', label: 'Dashed line', dash: '9 6' },
  { kind: 'line-dotted', label: 'Dotted line', dash: '0.1 8' },
];

export function ElementsPanel() {
  return (
    <div className="panel-scroll">
      <div className="panel-heading">Shapes</div>
      <div className="shape-grid">
        {SHAPES.map((s) => (
          <button key={s.kind} className="shape-cell" title={s.label} onClick={() => editor.addShape(s.kind)}>
            <svg viewBox="0 0 48 48" fill="#5c6470">{s.svg}</svg>
          </button>
        ))}
      </div>
      <div className="panel-heading">Lines</div>
      <div className="line-list">
        {LINES.map((l) => (
          <button key={l.kind} className="line-cell" title={l.label} onClick={() => editor.addShape(l.kind)}>
            <svg viewBox="0 0 120 12">
              <line x1="4" y1="6" x2="116" y2="6" stroke="#5c6470" strokeWidth="3" strokeLinecap="round" strokeDasharray={l.dash} />
            </svg>
          </button>
        ))}
      </div>
      <div className="hint">
        Click a shape to add it, then use the toolbar to change its color, border,
        corner rounding, transparency and rotation.
      </div>
    </div>
  );
}
