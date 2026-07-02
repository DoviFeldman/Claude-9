import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface PopoverProps {
  button: ReactNode | ((open: boolean) => ReactNode);
  children: ReactNode | ((close: () => void) => ReactNode);
  className?: string;
  panelClassName?: string;
  align?: 'left' | 'right';
  title?: string;
  disabled?: boolean;
  onClose?: () => void;
}

/**
 * Toolbar button + floating panel. The panel is portaled to <body> with fixed
 * positioning so scrollable/clipping ancestors (like the context toolbar)
 * can't cut it off. Closes on outside click / Escape.
 */
export function Popover({ button, children, className, panelClassName, align = 'left', title, disabled, onClose }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const panelW = panelRef.current?.offsetWidth ?? 260;
      let left = align === 'right' ? r.right - panelW : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - panelW - 8));
      setPos({ top: Math.min(r.bottom + 8, window.innerHeight - 80), left });
    };
    place();
    // reposition once the panel has real dimensions
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
      onClose?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); onClose?.(); }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const close = () => { setOpen(false); onClose?.(); };

  return (
    <div className={`popover-wrap ${className ?? ''}`} ref={triggerRef}>
      <div
        className={`popover-trigger${open ? ' open' : ''}${disabled ? ' disabled' : ''}`}
        title={title}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        {typeof button === 'function' ? button(open) : button}
      </div>
      {open && pos &&
        createPortal(
          <div
            ref={panelRef}
            className={`popover-panel ${panelClassName ?? ''}`}
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>,
          document.body,
        )}
    </div>
  );
}
