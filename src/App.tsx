import { useEffect, useState } from 'react';
import { editor } from './editor/Editor';
import { useEditor } from './editor/useEditor';
import { loadSavedDoc, purgeExpired } from './editor/db';
import { importPDF } from './editor/importers';
import { subscribeToasts, type Toast } from './editor/toast';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { ContextToolbar } from './components/ContextToolbar';
import { CanvasArea } from './components/CanvasArea';
import { BottomBar } from './components/BottomBar';
import { Icon } from './components/icons';

function PdfImportModal() {
  useEditor();
  const file = editor.pendingPdf;
  if (!file) return null;
  const close = () => { editor.pendingPdf = null; editor.notify(); };
  const run = (mode: 'editable' | 'flatten') => {
    close();
    void importPDF(file, mode);
  };
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Import “{file.name}”</div>
        <p className="modal-sub">How do you want to bring this PDF in?</p>
        <button className="modal-option" onClick={() => run('editable')}>
          <Icon name="text" size={22} />
          <span>
            <b>Editable text</b>
            <small>Extracts the text into editable text boxes so you can rewrite, restyle and move it. Graphics are not carried over.</small>
          </span>
        </button>
        <button className="modal-option" onClick={() => run('flatten')}>
          <Icon name="image" size={22} />
          <span>
            <b>Exact copy</b>
            <small>Each page becomes a high-quality image. Perfect look — design over it, crop it, or cover parts with boxes and new text.</small>
          </span>
        </button>
        <button className="btn-secondary full" onClick={close}>Cancel</button>
      </div>
    </div>
  );
}

function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
      ))}
    </div>
  );
}

export default function App() {
  useEditor();

  useEffect(() => {
    void (async () => {
      await purgeExpired();
      const saved = await loadSavedDoc();
      if (saved && saved.pages.length) editor.hydrate(saved);
    })();
    const beforeUnload = () => void editor.saveNow();
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        <Sidebar />
        <div className="workspace">
          <ContextToolbar />
          <CanvasArea />
          <BottomBar />
        </div>
      </div>
      <PdfImportModal />
      <Toasts />
    </div>
  );
}
