// QR code generation (browser-only). Produces a single SVG path string of the
// dark modules — one vector object, crisp at any size and recolorable.

import qrcode from 'qrcode-generator';

// The default byte encoder is Latin-1 only; use UTF-8 so any text works.
qrcode.stringToBytes = (s: string) => Array.from(new TextEncoder().encode(s));

export interface QRPathResult {
  /** SVG path data; coordinate space is one unit per module. */
  path: string;
  /** Number of modules per side (no quiet zone included). */
  modules: number;
}

/** Encode text into a QR path. Error correction M, auto version. */
export function qrPathData(text: string): QRPathResult {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const parts: string[] = [];
  // merge horizontal runs of dark modules so the path stays small
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (qr.isDark(r, c)) {
        let len = 1;
        while (c + len < n && qr.isDark(r, c + len)) len++;
        parts.push(`M${c} ${r}h${len}v1h-${len}z`);
        c += len;
      } else {
        c++;
      }
    }
  }
  return { path: parts.join(''), modules: n };
}
