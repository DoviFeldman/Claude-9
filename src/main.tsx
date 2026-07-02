import { createRoot } from 'react-dom/client';
import App from './App';
import { editor } from './editor/Editor';
import './styles.css';

// console access for debugging / power users
(window as unknown as { opencanvas: typeof editor }).opencanvas = editor;

createRoot(document.getElementById('root')!).render(<App />);
