// Pixel-level image features, all in-browser:
//  - OCR text extraction (tesseract.js, lazy-loaded) that lifts recognized
//    text into real editable Textboxes and can erase it from the image.
//  - Color separation: pull every pixel near a chosen color out of an image
//    into its own draggable object, with feathered edges and an optional
//    sticker-style border.

import * as fabric from 'fabric';
// OCR assets are bundled from node_modules at build time (no CDN): the worker
// script and the single-file WASM cores. The English traineddata is served
// from /tessdata/ by the `tessdata` Vite plugin (see vite.config.ts).
import coreLstmUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import coreSimdLstmUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';
import tessWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import { decorate, editor, ensureFont } from './Editor';

// ---------------------------------------------------------------- shared

function imageToCanvas(img: fabric.FabricImage): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const W = img.width!, H = img.height!;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img.getElement() as CanvasImageSource, 0, 0, W, H);
  return { canvas: c, ctx };
}

/** Map a point in image source pixels to scene coordinates. */
function imagePointToScene(img: fabric.FabricImage, x: number, y: number): fabric.Point {
  const m = img.calcTransformMatrix();
  return fabric.util.transformPoint(new fabric.Point(x - img.width! / 2, y - img.height! / 2), m);
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

// ---------------------------------------------------------------- OCR

export interface OCRLine {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  color: string;  // estimated text color
}

export interface OCRResult {
  lines: OCRLine[];
  text: string;
}

type TesseractWorker = import('tesseract.js').Worker;
let workerPromise: Promise<TesseractWorker> | null = null;
let progressHook: (pct: number, stage: string) => void = () => {};

function getWorker(onProgress: (pct: number, stage: string) => void): Promise<TesseractWorker> {
  progressHook = onProgress;
  if (!workerPromise) {
    workerPromise = (async () => {
      const [T, simdOk] = await Promise.all([
        import('tesseract.js'),
        import('wasm-feature-detect').then((w) => w.simd()).catch(() => false),
      ]);
      const langPath = new URL(`${import.meta.env.BASE_URL}tessdata`, location.href).href;
      return T.createWorker('eng', undefined, {
        workerPath: tessWorkerUrl,
        corePath: simdOk ? coreSimdLstmUrl : coreLstmUrl,
        langPath,
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') progressHook(m.progress, 'reading');
          else progressHook(0, 'loading');
        },
      });
    })().catch((err) => {
      workerPromise = null; // allow retry
      throw err;
    });
  }
  return workerPromise;
}

/** Average color of the 1px ring around a rect — a cheap "background" sample. */
function sampleRectBorder(data: ImageData, x0: number, y0: number, x1: number, y1: number): [number, number, number] {
  const { width, height, data: d } = data;
  let r = 0, g = 0, b = 0, n = 0;
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  };
  for (let x = x0; x <= x1; x++) { push(x, y0); push(x, y1); }
  for (let y = y0; y <= y1; y++) { push(x0, y); push(x1, y); }
  return n ? [r / n, g / n, b / n] : [255, 255, 255];
}

/** Estimate the text color inside a bbox: average of pixels far from the background. */
function estimateTextColor(data: ImageData, bbox: OCRLine['bbox'], bg: [number, number, number]): string {
  const { width, data: d } = data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = bbox.y0; y < bbox.y1; y++) {
    for (let x = bbox.x0; x < bbox.x1; x++) {
      const i = (y * width + x) * 4;
      if (Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]) > 80) {
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
    }
  }
  if (n < 4) return '#1a1a1a';
  return toHex(r / n, g / n, b / n);
}

/** Run OCR over the selected image and return recognized lines with boxes. */
export async function recognizeImageText(
  img: fabric.FabricImage,
  onProgress: (pct: number, stage: string) => void,
): Promise<OCRResult> {
  const { canvas, ctx } = imageToCanvas(img);
  const worker = await getWorker(onProgress);
  const res = await worker.recognize(canvas, {}, { blocks: true, text: true });
  const W = canvas.width, H = canvas.height;
  const data = ctx.getImageData(0, 0, W, H);
  const lines: OCRLine[] = [];
  for (const block of res.data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        const text = line.text.replace(/\s+$/, '');
        if (!text.trim() || line.confidence < 35) continue;
        const bbox = {
          x0: Math.max(0, Math.floor(line.bbox.x0)),
          y0: Math.max(0, Math.floor(line.bbox.y0)),
          x1: Math.min(W, Math.ceil(line.bbox.x1)),
          y1: Math.min(H, Math.ceil(line.bbox.y1)),
        };
        const bg = sampleRectBorder(data, bbox.x0, bbox.y0, bbox.x1 - 1, bbox.y1 - 1);
        lines.push({ text, bbox, color: estimateTextColor(data, bbox, bg) });
      }
    }
  }
  return { lines, text: lines.map((l) => l.text).join('\n') };
}

export interface ApplyOCROptions {
  /** Paint over the original text pixels in the image. */
  erase: boolean;
  /** Fill for the erased areas; null = auto-match the surrounding background. */
  eraseColor: string | null;
}

/**
 * Turn OCR lines into editable Textboxes placed over the image, optionally
 * erasing the original text pixels first (so the text can then live on any
 * background color). One undo step.
 */
export async function applyOCRToCanvas(
  img: fabric.FabricImage,
  lines: OCRLine[],
  opts: ApplyOCROptions,
): Promise<void> {
  const canvas = editor.activeCanvas;
  if (!canvas || lines.length === 0) return;
  await ensureFont('Inter');
  await editor.batch(async () => {
    if (opts.erase) {
      const { canvas: work, ctx } = imageToCanvas(img);
      const data = ctx.getImageData(0, 0, work.width, work.height);
      for (const line of lines) {
        const pad = 2;
        const x0 = Math.max(0, line.bbox.x0 - pad), y0 = Math.max(0, line.bbox.y0 - pad);
        const x1 = Math.min(work.width, line.bbox.x1 + pad), y1 = Math.min(work.height, line.bbox.y1 + pad);
        const fill = opts.eraseColor
          ? hexToRgb(opts.eraseColor)
          : sampleRectBorder(data, x0, y0, x1 - 1, y1 - 1);
        ctx.fillStyle = toHex(fill[0], fill[1], fill[2]);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      await img.setSrc(work.toDataURL('image/png'));
      img.dirty = true;
    }

    const sx = Math.abs(img.scaleX ?? 1);
    const sy = Math.abs(img.scaleY ?? 1);
    const created: fabric.FabricObject[] = [];
    for (const line of lines) {
      const h = line.bbox.y1 - line.bbox.y0;
      const w = line.bbox.x1 - line.bbox.x0;
      const tb = new fabric.Textbox(line.text, {
        width: w + 8,
        fontSize: Math.max(6, Math.round(h * 0.82)),
        fontFamily: 'Inter',
        fill: line.color,
        lineHeight: 1.1,
        textAlign: 'left',
        scaleX: sx,
        scaleY: sy,
        angle: img.angle ?? 0,
      });
      decorate(tb);
      const center = imagePointToScene(img, (line.bbox.x0 + line.bbox.x1) / 2, (line.bbox.y0 + line.bbox.y1) / 2);
      tb.setPositionByOrigin(center, 'center', 'center');
      canvas.add(tb);
      tb.setCoords();
      created.push(tb);
    }
    canvas.discardActiveObject();
    if (created.length === 1) {
      canvas.setActiveObject(created[0]);
    } else if (created.length > 1) {
      const sel = new fabric.ActiveSelection(created, { canvas });
      decorate(sel);
      canvas.setActiveObject(sel);
    }
    canvas.requestRenderAll();
  });
}

// ---------------------------------------------------------------- color separation

export interface SeparateOptions {
  hex: string;          // color to pull out
  tolerance: number;    // color-space tolerance (0–160)
  smooth: number;       // edge feather radius in px (0–20)
  border: number;       // sticker-outline width in px, 0 = off
  borderColor: string;
  removeFromOriginal: boolean;
}

/** Separable box blur on a single-channel mask (approximates a soft feather). */
function blurMask(mask: Float32Array, W: number, H: number, radius: number): Float32Array {
  if (radius < 1) return mask;
  const r = Math.round(radius);
  const tmp = new Float32Array(mask.length);
  const out = new Float32Array(mask.length);
  const span = r * 2 + 1;
  for (let y = 0; y < H; y++) {
    let acc = 0;
    const row = y * W;
    for (let x = -r; x <= r; x++) acc += mask[row + Math.max(0, Math.min(W - 1, x))];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = acc / span;
      acc += mask[row + Math.min(W - 1, x + r + 1)] - mask[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.max(0, Math.min(H - 1, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc / span;
      acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}

/**
 * Extract every pixel near `hex` from the selected image into a new, separate
 * image object (feathered edges, optional outline) placed next to the
 * original, and optionally make those pixels transparent in the original.
 */
export async function separateColorFromImage(img: fabric.FabricImage, opts: SeparateOptions): Promise<boolean> {
  const canvas = editor.activeCanvas;
  if (!canvas) return false;
  const W = img.width!, H = img.height!;
  const { canvas: work, ctx } = imageToCanvas(img);
  let src: ImageData;
  try {
    src = ctx.getImageData(0, 0, W, H);
  } catch {
    return false;
  }
  const [fr, fg, fb] = hexToRgb(opts.hex);
  const d = src.data;

  // soft color-space mask: 1 inside tolerance, fading to 0 over an extra 35%
  const tol = opts.tolerance;
  const fade = Math.max(8, tol * 0.35);
  let mask = new Float32Array(W * H);
  let any = false;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const dist = Math.hypot(d[i] - fr, d[i + 1] - fg, d[i + 2] - fb);
    const a = dist <= tol ? 1 : dist >= tol + fade ? 0 : 1 - (dist - tol) / fade;
    if (a > 0.4) any = true;
    mask[p] = a * (d[i + 3] / 255);
  }
  if (!any) return false;

  // spatial feather
  if (opts.smooth > 0) mask = blurMask(mask, W, H, opts.smooth / 2);

  // bounding box of the mask
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x] > 0.03) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0 || y1 < y0) return false;
  const pad = Math.ceil(opts.smooth + opts.border + 2);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;

  // the cutout: original pixels with the mask as alpha
  const cut = document.createElement('canvas');
  cut.width = cw; cut.height = ch;
  const cctx = cut.getContext('2d')!;
  const cdata = cctx.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((y + y0) * W + (x + x0)) * 4;
      const di = (y * cw + x) * 4;
      const a = mask[(y + y0) * W + (x + x0)];
      cdata.data[di] = d[si];
      cdata.data[di + 1] = d[si + 1];
      cdata.data[di + 2] = d[si + 2];
      cdata.data[di + 3] = Math.round(a * d[si + 3]);
    }
  }
  cctx.putImageData(cdata, 0, 0);

  // sticker-style border: stamp the silhouette in the border color around a circle
  let result = cut;
  if (opts.border > 0) {
    const sil = document.createElement('canvas');
    sil.width = cw; sil.height = ch;
    const sctx = sil.getContext('2d')!;
    sctx.drawImage(cut, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = opts.borderColor;
    sctx.fillRect(0, 0, cw, ch);
    const out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    const octx = out.getContext('2d')!;
    const steps = 16;
    for (let s = 0; s < steps; s++) {
      const ang = (s / steps) * Math.PI * 2;
      octx.drawImage(sil, Math.cos(ang) * opts.border, Math.sin(ang) * opts.border);
    }
    octx.drawImage(cut, 0, 0);
    result = out;
  }

  await editor.batch(async () => {
    if (opts.removeFromOriginal) {
      // dilate + boost the mask so anti-aliased halo pixels around the region go too
      const rm = blurMask(mask, W, H, 1.5);
      for (let p = 0, i = 3; i < d.length; p++, i += 4) {
        const a = Math.min(1, rm[p] * 2.2);
        if (a > 0) d[i] = Math.round(d[i] * (1 - a));
      }
      ctx.putImageData(src, 0, 0);
      await img.setSrc(work.toDataURL('image/png'));
      img.dirty = true;
    }

    const piece = await fabric.FabricImage.fromURL(result.toDataURL('image/png'));
    piece.set({
      scaleX: img.scaleX, scaleY: img.scaleY,
      flipX: img.flipX, flipY: img.flipY,
      angle: img.angle,
    });
    decorate(piece);
    const center = imagePointToScene(img, x0 + cw / 2, y0 + ch / 2);
    // nudge it so it reads as its own draggable piece
    piece.setPositionByOrigin(new fabric.Point(center.x + 28, center.y + 28), 'center', 'center');
    canvas.add(piece);
    piece.setCoords();
    canvas.discardActiveObject();
    canvas.setActiveObject(piece);
    canvas.requestRenderAll();
  });
  return true;
}
