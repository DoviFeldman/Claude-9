// Minimal global toast bus.

export interface Toast { id: number; message: string; kind: 'info' | 'error' }

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  fn(toasts);
  return () => { listeners.delete(fn); };
}

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  const t = { id: nextId++, message, kind };
  toasts = [...toasts, t];
  listeners.forEach((fn) => fn(toasts));
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    listeners.forEach((fn) => fn(toasts));
  }, 4000);
}
