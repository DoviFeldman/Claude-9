import { useState } from 'react';
import { editor } from '../editor/Editor';
import { exportProject, openProjectDialog } from '../editor/project';
import { useEditor } from '../editor/useEditor';
import { fromPx, toPx, type Unit } from '../constants';
import { Icon } from './icons';
import { Popover } from './Popover';
import { DownloadMenu } from './DownloadMenu';

function ResizePanel({ close }: { close: () => void }) {
  const [unit, setUnit] = useState<Unit>('px');
  const [w, setW] = useState(String(fromPx(editor.docW, 'px')));
  const [h, setH] = useState(String(fromPx(editor.docH, 'px')));

  const switchUnit = (u: Unit) => {
    const wPx = toPx(parseFloat(w) || 0, unit);
    const hPx = toPx(parseFloat(h) || 0, unit);
    setUnit(u);
    setW(String(fromPx(wPx, u)));
    setH(String(fromPx(hPx, u)));
  };

  return (
    <div className="resize-panel">
      <div className="panel-title">Resize canvas</div>
      <div className="resize-fields">
        <label>
          <span>Width</span>
          <input value={w} onChange={(e) => setW(e.target.value)} inputMode="decimal" />
        </label>
        <label>
          <span>Height</span>
          <input value={h} onChange={(e) => setH(e.target.value)} inputMode="decimal" />
        </label>
        <label>
          <span>Unit</span>
          <select value={unit} onChange={(e) => switchUnit(e.target.value as Unit)}>
            <option value="px">px</option>
            <option value="in">in</option>
            <option value="cm">cm</option>
            <option value="mm">mm</option>
          </select>
        </label>
      </div>
      <button
        className="btn-primary full"
        onClick={() => {
          const wPx = toPx(parseFloat(w) || 0, unit);
          const hPx = toPx(parseFloat(h) || 0, unit);
          if (wPx >= 16 && hPx >= 16) {
            editor.setDocSize(wPx, hPx);
            close();
          }
        }}
      >
        Resize
      </button>
      <div className="hint">Objects keep their size and position.</div>
    </div>
  );
}

export function TopBar() {
  useEditor();
  const [confirmNew, setConfirmNew] = useState(false);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="logo">
          <div className="logo-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="7" stroke="white" strokeWidth="3.4" />
            </svg>
          </div>
          <span className="logo-text">OpenCanvas</span>
        </div>
        <div className="topbar-sep" />
        <Popover
          title="Resize the canvas"
          button={<button className="tb-btn"><Icon name="fit" size={17} /><span className="tb-label">Resize</span></button>}
        >
          {(close) => <ResizePanel close={close} />}
        </Popover>
        <button
          className="tb-btn"
          onClick={() => void exportProject()}
          title="Save as a project file (.opencanvas) you can reopen or share for editing (Ctrl+S)"
        >
          <Icon name="save" size={17} /><span className="tb-label">Save</span>
        </button>
        <button
          className="tb-btn"
          onClick={() => openProjectDialog()}
          title="Open a saved .opencanvas project (Ctrl+O)"
        >
          <Icon name="folder" size={17} /><span className="tb-label">Open</span>
        </button>
        {!confirmNew ? (
          <button className="tb-btn" onClick={() => setConfirmNew(true)} title="Start a new design">
            <Icon name="file" size={17} /><span className="tb-label">New</span>
          </button>
        ) : (
          <span className="confirm-new">
            Clear this design?
            <button className="tb-btn danger" onClick={() => { editor.newDocument(); setConfirmNew(false); }}>Yes, clear</button>
            <button className="tb-btn" onClick={() => setConfirmNew(false)}>Cancel</button>
          </span>
        )}
        <div className="topbar-sep" />
        <button className="icon-btn" disabled={!editor.canUndo} onClick={() => void editor.undo()} title="Undo (Ctrl+Z)">
          <Icon name="undo" />
        </button>
        <button className="icon-btn" disabled={!editor.canRedo} onClick={() => void editor.redo()} title="Redo (Ctrl+Y)">
          <Icon name="redo" />
        </button>
      </div>

      <div className="topbar-center">
        <input
          className="doc-name"
          value={editor.docName}
          onChange={(e) => editor.setDocName(e.target.value)}
          onBlur={(e) => { if (!e.target.value.trim()) editor.setDocName('Untitled design'); }}
          spellCheck={false}
          aria-label="Design name"
        />
        <span className="doc-dims">{editor.docW} × {editor.docH} px</span>
      </div>

      <div className="topbar-right">
        {editor.busyMessage && <span className="busy-pill">{editor.busyMessage}</span>}
        <DownloadMenu />
      </div>
    </header>
  );
}
