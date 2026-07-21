// Original hand-rolled icon set (24x24, stroke-based).

import type { CSSProperties } from 'react';

const paths: Record<string, JSX.Element> = {
  design: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </>
  ),
  elements: (
    <>
      <circle cx="8" cy="8" r="4.5" />
      <path d="M13 13.5h8v8h-8z" />
      <path d="M7 21l4-7H3l4 7z" transform="translate(0 -1)" />
    </>
  ),
  text: <path d="M5 5h14M12 5v14M8.5 19h7" />,
  uploads: <path d="M12 16V4m0 0l-4.5 4.5M12 4l4.5 4.5M4 15v3.5A2.5 2.5 0 006.5 21h11a2.5 2.5 0 002.5-2.5V15" />,
  draw: <path d="M4 20c.5-3.5 1.6-5 3.2-6.6L16.5 4.1a2.2 2.2 0 013.2 0 2.2 2.2 0 010 3.2l-9.3 9.3C8.9 18.2 7.5 19.5 4 20z" />,
  pages: (
    <>
      <rect x="4" y="3" width="16" height="10" rx="2" />
      <rect x="4" y="17" width="16" height="4" rx="1.5" />
    </>
  ),
  undo: <path d="M8 5L3.5 9.5 8 14M4 9.5h10a6 6 0 016 6v.5" />,
  redo: <path d="M16 5l4.5 4.5L16 14M20 9.5H10a6 6 0 00-6 6v.5" />,
  download: <path d="M12 3v11m0 0l-4.5-4.5M12 14l4.5-4.5M4 17v1.5A2.5 2.5 0 006.5 21h11a2.5 2.5 0 002.5-2.5V17" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: <path d="M4 7h16M9.5 7V5a1.5 1.5 0 011.5-1.5h2A1.5 1.5 0 0114.5 5v2M6.5 7l.8 12a2 2 0 002 1.9h5.4a2 2 0 002-1.9l.8-12M10 11v6M14 11v6" />,
  duplicate: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 4.5H6.5A2.5 2.5 0 004 7v9.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9.5" rx="2.5" />
      <path d="M8 11V7.5a4 4 0 018 0V11" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="9.5" rx="2.5" />
      <path d="M8 11V7.5a4 4 0 017.6-1.7" />
    </>
  ),
  up: <path d="M12 19V5m0 0l-6 6m6-6l6 6" />,
  down: <path d="M12 5v14m0 0l-6-6m6 6l6-6" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  chevronLeft: <path d="M14 6.5l-5.5 5.5L14 17.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l5 5" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.5L21 9l-9 5.5L3 9l9-5.5z" />
      <path d="M4.5 13.5L12 18l7.5-4.5" />
    </>
  ),
  transparency: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M4 12h16M12 4v16M8 8h.01M16 8h.01M8 16h.01M16 16h.01" opacity=".5" />
    </>
  ),
  crop: <path d="M7 3v14h14M3 7h14v14" />,
  flipH: <path d="M12 3v18M7 8L3 12l4 4M17 8l4 4-4 4" />,
  flipV: <path d="M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4" />,
  palette: <path d="M12 3a9 9 0 100 18c1.6 0 2.2-1 1.6-2.2-.7-1.4.2-2.8 1.8-2.8H17a4 4 0 004-4c0-5-4-9-9-9zM7.5 10.5h.01M11 7h.01M15.5 8.5h.01M7 15h.01" />,
  magic: <path d="M6 21L18.5 8.5M14.5 4.5l.6 2 2 .6-2 .6-.6 2-.6-2-2-.6 2-.6.6-2zM19.5 13.5l.4 1.3 1.3.4-1.3.4-.4 1.3-.4-1.3-1.3-.4 1.3-.4.4-1.3zM8 3.5l.4 1.3 1.3.4-1.3.4L8 7l-.4-1.4-1.3-.4 1.3-.4L8 3.5z" />,
  group: (
    <>
      <rect x="3" y="3" width="10" height="10" rx="2" />
      <rect x="11" y="11" width="10" height="10" rx="2" />
    </>
  ),
  spacing: <path d="M4 4v16M20 4v16M9 12h6M9 12l2-2m-2 2l2 2m4-2l-2-2m2 2l-2 2" />,
  effects: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM18.5 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />,
  alignLeft: <path d="M4 5h16M4 10h10M4 15h16M4 20h10" />,
  alignCenter: <path d="M4 5h16M7 10h10M4 15h16M7 20h10" />,
  alignRight: <path d="M4 5h16M10 10h10M4 15h16M10 20h10" />,
  fit: <path d="M9 4H5.5A1.5 1.5 0 004 5.5V9m11-5h3.5A1.5 1.5 0 0120 5.5V9m0 6v3.5a1.5 1.5 0 01-1.5 1.5H15M9 20H5.5A1.5 1.5 0 014 18.5V15" />,
  link: <path d="M10 14a4.5 4.5 0 006.4.3l3-3a4.5 4.5 0 00-6.4-6.4l-1.4 1.5M14 10a4.5 4.5 0 00-6.4-.3l-3 3a4.5 4.5 0 006.4 6.4l1.4-1.5" />,
  rounding: <path d="M4 20v-6C4 8.5 8.5 4 14 4h6" />,
  border: <rect x="4" y="4" width="16" height="16" rx="3" strokeDasharray="4 3" />,
  eyedropper: <path d="M11 7l6 6M4 20l1-4L15.5 5.5a2.1 2.1 0 013 0 2.1 2.1 0 010 3L8 19l-4 1z" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="M3.5 18l5-5 4 4 3.5-3.5 4.5 4.5" />
    </>
  ),
  file: <path d="M13 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V9l-6-6zm0 0v6h6" />,
  save: <path d="M5 3h10.5L21 8.5V19a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM8 3v5.5h7V3M7.5 21v-7h9v7" />,
  folder: <path d="M3 7.5A2.5 2.5 0 015.5 5h3.6L11.5 7.5H18.5A2.5 2.5 0 0121 10v7a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17V7.5z" />,
  check: <path d="M5 13l4.5 4.5L19 7" />,
  qr: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <path d="M13.5 13.5h3v3h-3zM17.5 17.5h3v3h-3zM13.5 20.5h.01M20.5 13.5h.01" />
    </>
  ),
  scanText: (
    <>
      <path d="M8 3.5H5.5A2 2 0 003.5 5.5V8M16 3.5h2.5a2 2 0 012 2V8M8 20.5H5.5a2 2 0 01-2-2V16M16 20.5h2.5a2 2 0 002-2V16" />
      <path d="M7.5 9h9M12 9v6.5M10 15.5h4" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <path d="M8.6 8.1L20 17M8.6 15.9L20 7M13.2 11.7l.01.01" />
    </>
  ),
  shield: <path d="M12 3l7.5 3v5.5c0 4.4-3 8-7.5 9.5-4.5-1.5-7.5-5.1-7.5-9.5V6L12 3zM9 12l2.2 2.2L15.5 9.8" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5h.01" />
    </>
  ),
};

export function Icon({ name, size = 20, style }: { name: keyof typeof paths | string; size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden
    >
      {paths[name] ?? null}
    </svg>
  );
}
