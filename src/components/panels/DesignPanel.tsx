import { useState } from 'react';
import { TEMPLATES, fromPx, toPx, type Unit } from '../../constants';
import { editor } from '../../editor/Editor';
import { useEditor } from '../../editor/useEditor';

export function DesignPanel() {
  useEditor();
  const [unit, setUnit] = useState<Unit>('px');
  const [w, setW] = useState('1280');
  const [h, setH] = useState('720');

  const groups = [...new Set(TEMPLATES.map((t) => t.group))];

  const apply = () => {
    const wPx = toPx(parseFloat(w) || 0, unit);
    const hPx = toPx(parseFloat(h) || 0, unit);
    if (wPx >= 16 && hPx >= 16) editor.setDocSize(wPx, hPx);
  };

  return (
    <div className="panel-scroll">
      <div className="panel-heading">Canvas size</div>
      <div className="size-form">
        <input value={w} onChange={(e) => setW(e.target.value)} inputMode="decimal" aria-label="Width" />
        <span className="size-x">×</span>
        <input value={h} onChange={(e) => setH(e.target.value)} inputMode="decimal" aria-label="Height" />
        <select
          value={unit}
          onChange={(e) => {
            const u = e.target.value as Unit;
            setW(String(fromPx(toPx(parseFloat(w) || 0, unit), u)));
            setH(String(fromPx(toPx(parseFloat(h) || 0, unit), u)));
            setUnit(u);
          }}
        >
          <option value="px">px</option>
          <option value="in">in</option>
          <option value="cm">cm</option>
          <option value="mm">mm</option>
        </select>
      </div>
      <button className="btn-primary full" onClick={apply}>Create / resize</button>
      <div className="hint">Current canvas: {editor.docW} × {editor.docH} px</div>

      {groups.map((g) => (
        <div key={g}>
          <div className="panel-heading">{g}</div>
          <div className="template-grid">
            {TEMPLATES.filter((t) => t.group === g).map((t) => {
              const ratio = t.h / t.w;
              return (
                <button key={t.name} className="template-card" onClick={() => editor.setDocSize(t.w, t.h)}>
                  <span
                    className="template-thumb"
                    style={{
                      background: t.gradient,
                      aspectRatio: `${t.w} / ${t.h}`,
                      maxHeight: 84,
                      width: ratio > 1.2 ? 'auto' : '100%',
                      height: ratio > 1.2 ? 84 : 'auto',
                    }}
                  />
                  <span className="template-name">{t.name}</span>
                  <span className="template-dims">{t.w} × {t.h} px</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
