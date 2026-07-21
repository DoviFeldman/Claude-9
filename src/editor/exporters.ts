// Exporters: JPG / PNG / SVG / PDF / HTML, for all pages, the current page,
// or just the current selection. Rendering happens on an offscreen
// StaticCanvas so the on-screen zoom never affects output.

import * as fabric from 'fabric';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import { objectsToDXF } from './dxf';
import { applyExportMeta } from './exifmeta';
import { editor, EXTRA_PROPS, isTextObject, sceneBBox } from './Editor';
import { toast } from './toast';

export type ExportFormat = 'jpg' | 'png' | 'pdf' | 'svg' | 'html' | 'dxf';
export type ExportScope = 'all' | 'current' | 'selection';
export type ExportCompression = 'original' | 'balanced' | 'compressed' | 'max';

/** JPEG encode quality per compression level (applies to JPG and PDF). */
export const COMPRESSION_QUALITY: Record<ExportCompression, number> = {
  original: 0.95,
  balanced: 0.8,
  compressed: 0.6,
  max: 0.4,
};

export interface ExportOptions {
  format: ExportFormat;
  scope: ExportScope;
  scale: number; // raster multiplier
  transparent: boolean; // PNG only
  compression?: ExportCompression; // JPG & PDF only; default 'original'
}

export function safeName(): string {
  return (editor.docName || 'design').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'design';
}

export function saveBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export function dataURLToBlob(url: string): Blob {
  const [head, body] = url.split(',');
  const mime = head.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

interface OffscreenResult {
  canvas: fabric.StaticCanvas;
  dispose: () => void;
}

async function renderOffscreen(
  json: string,
  opts: { omitTopLevelText?: boolean; transparent?: boolean } = {},
): Promise<OffscreenResult> {
  const el = document.createElement('canvas');
  const sc = new fabric.StaticCanvas(el, { width: editor.docW, height: editor.docH });
  await sc.loadFromJSON(JSON.parse(json));
  if (opts.omitTopLevelText) {
    sc.getObjects().filter(isTextObject).forEach((o) => sc.remove(o));
  }
  if (opts.transparent) sc.backgroundColor = '';
  sc.renderAll();
  return { canvas: sc, dispose: () => void sc.dispose() };
}

function pageJSONs(scope: ExportScope): string[] {
  const pages = scope === 'current'
    ? editor.pages.filter((p) => p.id === editor.activePageId)
    : editor.pages;
  return pages.map((p) => {
    const c = editor.getCanvas(p.id);
    return c ? editor.serializePage(c) : '{"objects":[]}';
  });
}

async function rasterizeSelection(format: 'jpeg' | 'png', scale: number, quality = 0.92): Promise<string | null> {
  const obj = editor.getActiveObject();
  if (!obj) return null;
  const png = obj.toDataURL({ format: 'png', multiplier: scale });
  if (format === 'png') return png;
  // composite over white for JPG
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(null);
    img.src = png;
  });
}

function selectionSVG(): string | null {
  const canvas = editor.activeCanvas;
  const active = canvas?.getActiveObject();
  if (!canvas || !active) return null;
  const objs = canvas.getActiveObjects();
  canvas.discardActiveObject(); // restores absolute coordinates on children
  const parts = objs.map((o) => o.toSVG());
  const boxes = objs.map(sceneBBox);
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  // restore selection
  if (objs.length === 1) canvas.setActiveObject(objs[0]);
  else if (objs.length > 1) {
    const sel = new fabric.ActiveSelection(objs, { canvas });
    canvas.setActiveObject(sel);
  }
  canvas.requestRenderAll();
  const w = Math.max(1, right - left), h = Math.max(1, bottom - top);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w.toFixed(1)}" height="${h.toFixed(1)}" viewBox="${left.toFixed(1)} ${top.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}">\n${parts.join('\n')}\n</svg>`;
}

// ---------------------------------------------------------------- DXF export

/** DXF for the current selection, with absolute coords (mirrors selectionSVG). */
function selectionDXF(): ReturnType<typeof objectsToDXF> | null {
  const canvas = editor.activeCanvas;
  const active = canvas?.getActiveObject();
  if (!canvas || !active) return null;
  const objs = canvas.getActiveObjects();
  canvas.discardActiveObject(); // restores absolute coordinates on children
  const res = objectsToDXF(objs, editor.docH);
  if (objs.length === 1) canvas.setActiveObject(objs[0]);
  else if (objs.length > 1) {
    const sel = new fabric.ActiveSelection(objs, { canvas });
    canvas.setActiveObject(sel);
  }
  canvas.requestRenderAll();
  return res;
}

async function exportDXFFile(scope: ExportScope): Promise<void> {
  let skipped = 0;
  let entities = 0;
  const files: { name: string; blob: Blob }[] = [];
  if (scope === 'selection') {
    const res = selectionDXF();
    if (!res) return;
    skipped = res.skippedImages;
    entities = res.entityCount;
    files.push({ name: `${safeName()}.dxf`, blob: new Blob([res.dxf], { type: 'application/dxf' }) });
  } else {
    const jsons = pageJSONs(scope);
    for (let i = 0; i < jsons.length; i++) {
      const { canvas: sc, dispose } = await renderOffscreen(jsons[i]);
      const res = objectsToDXF(sc.getObjects(), editor.docH);
      dispose();
      skipped += res.skippedImages;
      entities += res.entityCount;
      const suffix = jsons.length > 1 ? `-page-${i + 1}` : '';
      files.push({ name: `${safeName()}${suffix}.dxf`, blob: new Blob([res.dxf], { type: 'application/dxf' }) });
    }
  }
  if (entities === 0) {
    toast('Nothing here can be drawn in a DXF — add shapes, lines, drawings or text.', 'error');
    return;
  }
  if (files.length === 1) {
    saveBlob(files[0].blob, files[0].name);
  } else {
    const zip = new JSZip();
    files.forEach((f) => zip.file(f.name, f.blob));
    saveBlob(await zip.generateAsync({ type: 'blob' }), `${safeName()}.zip`);
  }
  if (skipped > 0) {
    toast(`${skipped} image${skipped > 1 ? 's were' : ' was'} skipped — DXF only holds vector outlines and text.`);
  }
}

// ---------------------------------------------------------------- HTML export

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function textObjectToHTML(o: Record<string, any>): string {
  const fontSize = (o.fontSize ?? 16) * (o.scaleY ?? 1);
  const width = (o.width ?? 100) * (o.scaleX ?? 1);
  const styles: string[] = [
    'position:absolute',
    `left:${(o.left ?? 0).toFixed(1)}px`,
    `top:${(o.top ?? 0).toFixed(1)}px`,
    `width:${width.toFixed(1)}px`,
    `font-size:${fontSize.toFixed(1)}px`,
    `font-family:'${o.fontFamily ?? 'Inter'}',sans-serif`,
    `color:${o.fill ?? '#000'}`,
    `font-weight:${o.fontWeight ?? 400}`,
    `text-align:${o.textAlign ?? 'left'}`,
    `line-height:${o.lineHeight ?? 1.16}`,
    'white-space:pre-wrap',
    'margin:0',
  ];
  if (o.angle) styles.push(`transform:rotate(${o.angle}deg)`, 'transform-origin:left top');
  if (o.fontStyle && o.fontStyle !== 'normal') styles.push(`font-style:${o.fontStyle}`);
  const deco: string[] = [];
  if (o.underline) deco.push('underline');
  if (o.linethrough) deco.push('line-through');
  if (deco.length) styles.push(`text-decoration:${deco.join(' ')}`);
  if (o.charSpacing) styles.push(`letter-spacing:${((o.charSpacing / 1000) * fontSize).toFixed(2)}px`);
  if (o.opacity !== undefined && o.opacity < 1) styles.push(`opacity:${o.opacity}`);
  if (o.backgroundColor) styles.push(`background:${o.backgroundColor}`);
  if (o.shadow) {
    const sh = o.shadow;
    styles.push(`text-shadow:${sh.offsetX ?? 0}px ${sh.offsetY ?? 0}px ${sh.blur ?? 0}px ${sh.color ?? '#000'}`);
  }
  return `    <div style="${styles.join(';')}">${esc(o.text ?? '')}</div>`;
}

async function exportHTMLFile(scope: ExportScope): Promise<void> {
  const jsons = pageJSONs(scope === 'selection' ? 'current' : scope);
  const fonts = new Set<string>();
  const pagesHtml: string[] = [];
  for (const json of jsons) {
    const parsed = JSON.parse(json);
    const textObjs: Record<string, any>[] = (parsed.objects ?? []).filter(
      (o: any) => o.type === 'Textbox' || o.type === 'IText' || o.type === 'Text'
        || o.type === 'textbox' || o.type === 'i-text' || o.type === 'text',
    );
    textObjs.forEach((o) => o.fontFamily && fonts.add(o.fontFamily));
    const { canvas: sc, dispose } = await renderOffscreen(json, { omitTopLevelText: true });
    const bg = sc.toDataURL({ format: 'jpeg', quality: 0.9, multiplier: 1 });
    dispose();
    pagesHtml.push(
      `  <div class="page" style="position:relative;width:${editor.docW}px;height:${editor.docH}px;background-image:url(${bg});background-size:100% 100%;overflow:hidden;margin:24px auto;box-shadow:0 2px 12px rgba(0,0,0,.15)">\n${textObjs.map(textObjectToHTML).join('\n')}\n  </div>`,
    );
  }
  const fontLink = fonts.size
    ? `  <link href="https://fonts.googleapis.com/css2?${[...fonts].map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;600;700`).join('&')}&display=swap" rel="stylesheet">\n`
    : '';
  const html = `<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>${esc(editor.docName)}</title>\n${fontLink}  <style>body{margin:0;background:#f0f1f5;font-family:Inter,sans-serif}</style>\n</head>\n<body>\n${pagesHtml.join('\n')}\n</body>\n</html>\n`;
  saveBlob(new Blob([html], { type: 'text/html' }), `${safeName()}.html`);
}

// ---------------------------------------------------------------- main entry

export async function runExport(opts: ExportOptions): Promise<void> {
  const { format, scale } = opts;
  const quality = COMPRESSION_QUALITY[opts.compression ?? 'original'];
  let scope = opts.scope;
  if (scope === 'selection' && !editor.getActiveObject()) scope = 'current';

  editor.setBusy('Preparing your download…');
  try {
    if (format === 'html') {
      await exportHTMLFile(scope);
      return;
    }
    if (format === 'dxf') {
      await exportDXFFile(scope);
      return;
    }

    if (scope === 'selection') {
      if (format === 'svg') {
        const svg = selectionSVG();
        if (svg) saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${safeName()}.svg`);
        return;
      }
      if (format === 'pdf') {
        const url = await rasterizeSelection('jpeg', scale, quality);
        const obj = editor.getActiveObject();
        if (!url || !obj) return;
        const b = sceneBBox(obj);
        const wpt = b.width * 0.75, hpt = b.height * 0.75;
        const doc = new jsPDF({ unit: 'pt', format: [wpt, hpt], orientation: wpt > hpt ? 'landscape' : 'portrait' });
        doc.addImage(url, 'JPEG', 0, 0, wpt, hpt);
        doc.save(`${safeName()}.pdf`);
        return;
      }
      const url = await rasterizeSelection(format === 'jpg' ? 'jpeg' : 'png', scale, quality);
      if (url) saveBlob(applyExportMeta(url, format), `${safeName()}.${format}`);
      return;
    }

    const jsons = pageJSONs(scope);

    if (format === 'pdf') {
      const wpt = editor.docW * 0.75, hpt = editor.docH * 0.75;
      const orientation = wpt > hpt ? 'landscape' : 'portrait';
      const doc = new jsPDF({ unit: 'pt', format: [wpt, hpt], orientation });
      for (let i = 0; i < jsons.length; i++) {
        if (i > 0) doc.addPage([wpt, hpt], orientation);
        const { canvas: sc, dispose } = await renderOffscreen(jsons[i]);
        const url = sc.toDataURL({ format: 'jpeg', quality, multiplier: Math.max(scale, 2) });
        dispose();
        doc.addImage(url, 'JPEG', 0, 0, wpt, hpt);
      }
      doc.save(`${safeName()}.pdf`);
      return;
    }

    const files: { name: string; blob: Blob }[] = [];
    for (let i = 0; i < jsons.length; i++) {
      const suffix = jsons.length > 1 ? `-page-${i + 1}` : '';
      if (format === 'svg') {
        const { canvas: sc, dispose } = await renderOffscreen(jsons[i]);
        const svg = sc.toSVG();
        dispose();
        files.push({ name: `${safeName()}${suffix}.svg`, blob: new Blob([svg], { type: 'image/svg+xml' }) });
      } else {
        const { canvas: sc, dispose } = await renderOffscreen(jsons[i], {
          transparent: format === 'png' && opts.transparent,
        });
        const url = sc.toDataURL({
          format: format === 'jpg' ? 'jpeg' : 'png',
          quality,
          multiplier: scale,
        });
        dispose();
        files.push({ name: `${safeName()}${suffix}.${format}`, blob: applyExportMeta(url, format) });
      }
    }
    if (files.length === 1) {
      saveBlob(files[0].blob, files[0].name);
    } else {
      const zip = new JSZip();
      files.forEach((f) => zip.file(f.name, f.blob));
      const blob = await zip.generateAsync({ type: 'blob' });
      saveBlob(blob, `${safeName()}.zip`);
    }
  } catch (err) {
    console.error(err);
    toast('Export failed — please try again.', 'error');
  } finally {
    editor.setBusy(null);
  }
}
