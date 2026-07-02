import { useSyncExternalStore } from 'react';
import { editor } from './Editor';

/** Re-renders the component whenever the editor state changes. */
export function useEditor(): number {
  return useSyncExternalStore(editor.subscribe, editor.getVersion);
}
