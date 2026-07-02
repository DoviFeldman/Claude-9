// Color utilities: conversions, palette extraction from images.

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const p = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`;
}

/** Normalize any css color (hex, rgb(), rgba()) to #rrggbb, or null. */
export function anyToHex(color: unknown): string | null {
  if (typeof color !== 'string' || !color) return null;
  if (color.startsWith('#')) {
    const rgb = hexToRgb(color);
    return rgb ? rgbToHex(rgb.r, rgb.g, rgb.b) : null;
  }
  const m = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (m) return rgbToHex(+m[1], +m[2], +m[3]);
  return null;
}

export function hexWithAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${clamp(alpha, 0, 1)})`;
}

// HSV <-> RGB for the custom picker
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/** Extract a small dominant-color palette from an image element or canvas. */
export function extractPalette(
  source: HTMLImageElement | HTMLCanvasElement,
  count = 6,
): string[] {
  try {
    const size = 48;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    // Bucket colors coarsely, keep running average per bucket.
    const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 128) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const key = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
      const entry = buckets.get(key);
      if (entry) { entry.r += r; entry.g += g; entry.b += b; entry.n++; }
      else buckets.set(key, { r, g, b, n: 1 });
    }
    const sorted = [...buckets.values()].sort((a, b) => b.n - a.n);
    const out: string[] = [];
    for (const e of sorted) {
      const hex = rgbToHex(e.r / e.n, e.g / e.n, e.b / e.n);
      // skip colors too close to ones we already have
      const rgb = hexToRgb(hex)!;
      const tooClose = out.some((o) => {
        const p = hexToRgb(o)!;
        return Math.hypot(p.r - rgb.r, p.g - rgb.g, p.b - rgb.b) < 40;
      });
      if (!tooClose) out.push(hex);
      if (out.length >= count) break;
    }
    return out;
  } catch {
    return [];
  }
}

export async function paletteFromDataURL(url: string, count = 6): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(extractPalette(img, count));
    img.onerror = () => resolve([]);
    img.src = url;
  });
}
