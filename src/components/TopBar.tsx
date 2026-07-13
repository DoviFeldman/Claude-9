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

const SITE_URL = 'https://opencanvas-ashy.vercel.app/';
const CODE_URL = 'https://anonymous.4open.science/r/OpenCanvas/README.md';

function AboutPanel() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(SITE_URL);
      ok = true;
    } catch {
      // fallback for browsers without clipboard API access
      const ta = document.createElement('textarea');
      ta.value = SITE_URL;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch { /* nothing more we can do */ }
      ta.remove();
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="about-panel">
      <button className={`about-copy${copied ? ' copied' : ''}`} onClick={copy} title={SITE_URL}>
        <Icon name={copied ? 'check' : 'link'} size={16} />
        <span className="about-url">opencanvas-ashy.vercel.app</span>
        <span className="about-copy-hint">{copied ? 'Copied!' : 'Click to copy'}</span>
      </button>
      <div className="about-title">OpenCanvas</div>
      <p className="about-text">
        A free, open-source design editor in the spirit of Canva. No accounts, no
        tracking — everything you make stays in your browser. Self-hostable on
        Vercel (or any static host) in a couple of clicks.
      </p>
      <a className="about-link" href={CODE_URL} target="_blank" rel="noreferrer">
        <Icon name="file" size={15} />
        View the source code
      </a>
    </div>
  );
}

export function TopBar() {
  useEditor();
  const [confirmNew, setConfirmNew] = useState(false);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Popover
          title="About OpenCanvas — share link & source code"
          panelClassName="about-pop"
          button={
            <button className="logo" aria-label="About OpenCanvas">
              <div className="logo-mark">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="7" stroke="white" strokeWidth="3.4" />
                </svg>
              </div>
              <span className="logo-text">OpenCanvas</span>
            </button>
          }
        >
          <AboutPanel />
        </Popover>
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
          <Icon name="save" size={17} /><span>Save</span>
        </button>
        <button
          className="tb-btn"
          onClick={() => openProjectDialog()}
          title="Open a saved .opencanvas project (Ctrl+O)"
        >
          <Icon name="folder" size={17} /><span>Open</span>
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
