import { createRoot } from 'react-dom/client';
import App from './App';
import { editor } from './editor/Editor';
import { initFonts } from './editor/fonts';
import './styles.css';

// console access for debugging / power users
(window as unknown as { opencanvas: typeof editor }).opencanvas = editor;

// re-register custom fonts saved from previous visits
void initFonts().then(() => editor.notify());

// optional PWA: quiet offline support, no install prompt of any kind
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* fine without it */ });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
