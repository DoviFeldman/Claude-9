// File importers: images, SVG, PDF (editable or flattened), PPTX (basic), HTML.

import * as fabric from 'fabric';
import JSZip from 'jszip';
import { editor, ensureFont, newId } from './Editor';
import { blobToDataURL, uploadPut, type UploadRecord } from './db';
import { paletteFromDataURL } from './colors';
import { toast } from './toast';

export function classifyFile(file: File): UploadRecord['kind'] | null {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('image/svg') || name.endsWith('.svg')) return 'svg';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.pptx')) return 'pptx';
  if (file.type === 'text/html' || name.endsWith('.html') || name.endsWith('.htm')) return 'html';
  return null;
}

/** Save a file into the uploads folder (IndexedDB) so it can be reused later. */
export async function saveUpload(file: File): Promise<UploadRecord | null> {
  const kind = classifyFile(file);
  if (!kind) return null;
  const rec: UploadRecord = {
    id: newId(),
    name: file.name,
    kind,
    mime: file.type || 'application/octet-stream',
    blob: file,
    addedAt: Date.now(),
    lastUsed: Date.now(),
  };
  if (kind === 'image') {
    const url = await blobToDataURL(file);
    rec.palette = await paletteFromDataURL(url);
    rec.thumb = await makeThumb(url);
  } else if (kind === 'svg') {
    rec.thumb = await blobToDataURL(file);
  }
  try {
    await uploadPut(rec);
    editor.uploadsVersion++;
    editor.notify();
  } catch {
    toast('Could not save to your uploads folder (storage unavailable).', 'error');
  }
  return rec;
}

async function makeThumb(dataUrl: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 240;
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * s));
      c.height = Math.max(1, Math.round(img.height * s));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve(undefined);
    img.src = dataUrl;
  });
}

/** Insert an already-stored upload into the current page. */
export async function insertUpload(rec: UploadRecord): Promise<void> {
  if (rec.kind === 'image') {
    const url = await blobToDataURL(rec.blob);
    await editor.addImageFromDataURL(url, { palette: rec.palette });
  } else if (rec.kind === 'svg') {
    await editor.addSVGFromString(await rec.blob.text());
  } else if (rec.kind === 'pdf') {
    editor.pendingPdf = new File([rec.blob], rec.name, { type: 'application/pdf' });
    editor.notify();
  } else if (rec.kind === 'pptx') {
    await importPPTX(rec.blob, rec.name);
  } else if (rec.kind === 'html') {
    await importHTML(await rec.blob.text());
  }
}

/** True if the file is a zip containing design.json — a project file that may
 *  have been renamed by the browser or OS on download. */
async function looksLikeProject(file: File): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(file);
    return !!zip.file('design.json');
  } catch {
    return false;
  }
}

/** Entry point for drag-drop / file input / paste. Saves to uploads then inserts. */
export async function importFiles(files: File[] | FileList): Promise<void> {
  for (const file of Array.from(files)) {
    if (file.name.toLowerCase().endsWith('.opencanvas')) {
      const { confirmAndImportProject } = await import('./project');
      await confirmAndImportProject(file);
      continue;
    }
    const kind = classifyFile(file);
    if (!kind) {
      if (await looksLikeProject(file)) {
        const { confirmAndImportProject } = await import('./project');
        await confirmAndImportProject(file);
        continue;
      }
      toast(`"${file.name}" isn't a supported file type.`, 'error');
      continue;
    }
    const rec = await saveUpload(file);
    if (!rec) continue;
    try {
      if (kind === 'pdf') {
        editor.pendingPdf = file; // ask the user: editable vs exact
        editor.notify();
      } else {
        await insertUpload(rec);
      }
    } catch (err) {
      console.error(err);
      toast(`Couldn't import "${file.name}".`, 'error');
    }
  }
}

// ---------------------------------------------------------------- PDF

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export async function importPDF(file: File, mode: 'editable' | 'flatten'): Promise<void> {
  editor.setBusy('Importing PDF…');
  try {
    const pdfjs = await getPdfjs();
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const first = await pdf.getPage(1);
    const v1 = first.getViewport({ scale: 1 });
    const pageWpx = Math.round(v1.width * (96 / 72));
    const pageHpx = Math.round(v1.height * (96 / 72));

    const fresh = editor.isFresh();
    if (fresh) editor.setDocSize(pageWpx, pageHpx);
    const fit = Math.min(editor.docW / pageWpx, editor.docH / pageHpx);

    for (let i = 1; i <= pdf.numPages; i++) {
      editor.setBusy(`Importing PDF… page ${i}/${pdf.numPages}`);
      const page = await pdf.getPage(i);
      const pageId = fresh && i === 1
        ? editor.pages[0].id
        : editor.addPage(editor.pages.length - 1, undefined, false);
      const canvas = await editor.waitForCanvas(pageId);

      await editor.batch(async () => {
        if (mode === 'flatten') {
          const scale = (96 / 72) * fit * 2; // 2x for sharpness
          const vp = page.getViewport({ scale });
          const c = document.createElement('canvas');
          c.width = Math.ceil(vp.width);
          c.height = Math.ceil(vp.height);
          await page.render({ canvasContext: c.getContext('2d')!, viewport: vp } as any).promise;
          const img = await fabric.FabricImage.fromURL(c.toDataURL('image/jpeg', 0.92));
          img.scale((editor.docW * 1) / img.width!);
          img.set({ left: 0, top: 0 });
          canvas.add(img);
          canvas.requestRenderAll();
        } else {
          await extractEditableText(page, canvas, fit);
        }
      }, pageId);
    }
    editor.setActivePage(editor.pages[0].id);
    toast(`Imported ${pdf.numPages} PDF page${pdf.numPages > 1 ? 's' : ''} (${mode === 'editable' ? 'editable text' : 'exact copy'}).`);
  } catch (err) {
    console.error(err);
    toast('Could not read that PDF.', 'error');
  } finally {
    editor.setBusy(null);
  }
}

async function extractEditableText(
  page: import('pdfjs-dist').PDFPageProxy,
  canvas: fabric.Canvas,
  fit: number,
): Promise<void> {
  const pdfjs = await getPdfjs();
  const scale = (96 / 72) * fit;
  const vp = page.getViewport({ scale });
  const content = await page.getTextContent();
  const styles = content.styles as Record<string, { fontFamily?: string }>;

  interface Run { x: number; y: number; size: number; width: number; text: string; font: string }
  const runs: Run[] = [];
  for (const item of content.items as any[]) {
    if (!item.str || !item.str.trim()) continue;
    const tx = pdfjs.Util.transform(vp.transform, item.transform);
    const size = Math.hypot(tx[2], tx[3]);
    if (size < 1) continue;
    const fam = styles[item.fontName]?.fontFamily ?? 'sans-serif';
    const font = fam.includes('serif') && !fam.includes('sans') ? 'Georgia'
      : fam.includes('mono') ? 'Courier Prime' : 'Inter';
    runs.push({ x: tx[4], y: tx[5] - size, size, width: (item.width ?? 0) * scale, text: item.str, font });
  }
  // merge runs that sit on the same baseline into single text objects
  runs.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Run[] = [];
  for (const r of runs) {
    const last = lines[lines.length - 1];
    if (
      last &&
      Math.abs(last.y - r.y) < Math.max(2, last.size * 0.3) &&
      last.font === r.font &&
      Math.abs(last.size - r.size) < 1.5 &&
      r.x - (last.x + last.width) < last.size * 1.5
    ) {
      const gap = r.x - (last.x + last.width);
      last.text += (gap > last.size * 0.18 ? ' ' : '') + r.text;
      last.width = r.x + r.width - last.x;
    } else {
      lines.push({ ...r });
    }
  }
  await ensureFont('Inter');
  for (const line of lines) {
    const it = new fabric.IText(line.text, {
      left: line.x,
      top: line.y,
      fontSize: line.size,
      fontFamily: line.font,
      fill: '#1a1a1a',
    });
    canvas.add(it);
  }
  canvas.requestRenderAll();
}

// ---------------------------------------------------------------- PPTX

const EMU_PER_PX = 9525;

export async function importPPTX(blob: Blob, name: string): Promise<void> {
  editor.setBusy('Importing presentation…');
  try {
    const zip = await JSZip.loadAsync(blob);
    const presXml = await zip.file('ppt/presentation.xml')?.async('text');
    if (!presXml) throw new Error('not a pptx');
    const parser = new DOMParser();
    const pres = parser.parseFromString(presXml, 'application/xml');
    const sldSz = pres.getElementsByTagName('p:sldSz')[0];
    const slideW = sldSz ? +sldSz.getAttribute('cx')! / EMU_PER_PX : 960;
    const slideH = sldSz ? +sldSz.getAttribute('cy')! / EMU_PER_PX : 540;

    const fresh = editor.isFresh();
    if (fresh) editor.setDocSize(Math.round(slideW), Math.round(slideH));
    const fit = Math.min(editor.docW / slideW, editor.docH / slideH);

    const slideNames = Object.keys(zip.files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => +a.match(/(\d+)/)![1] - +b.match(/(\d+)/)![1]);

    let slideIdx = 0;
    for (const slidePath of slideNames) {
      slideIdx++;
      editor.setBusy(`Importing slide ${slideIdx}/${slideNames.length}…`);
      const pageId = fresh && slideIdx === 1
        ? editor.pages[0].id
        : editor.addPage(editor.pages.length - 1, undefined, false);
      const canvas = await editor.waitForCanvas(pageId);

      await editor.batch(async () => {
      const xml = parser.parseFromString(await zip.file(slidePath)!.async('text'), 'application/xml');
      const relsPath = slidePath.replace('slides/', 'slides/_rels/') + '.rels';
      const relsXmlText = await zip.file(relsPath)?.async('text');
      const rels = new Map<string, string>();
      if (relsXmlText) {
        const relsXml = parser.parseFromString(relsXmlText, 'application/xml');
        for (const rel of Array.from(relsXml.getElementsByTagName('Relationship'))) {
          rels.set(rel.getAttribute('Id')!, rel.getAttribute('Target')!);
        }
      }

      // pictures
      for (const pic of Array.from(xml.getElementsByTagName('p:pic'))) {
        const blip = pic.getElementsByTagName('a:blip')[0];
        const rid = blip?.getAttribute('r:embed');
        const target = rid ? rels.get(rid) : null;
        if (!target) continue;
        const mediaPath = target.startsWith('../') ? 'ppt/' + target.slice(3) : 'ppt/slides/' + target;
        const mediaFile = zip.file(mediaPath);
        if (!mediaFile) continue;
        const dataUrl = await blobToDataURL(await mediaFile.async('blob'));
        const pos = readXfrm(pic, fit);
        try {
          const img = await fabric.FabricImage.fromURL(dataUrl);
          if (pos) {
            img.set({ left: pos.x, top: pos.y, scaleX: pos.w / img.width!, scaleY: pos.h / img.height! });
          } else {
            img.scale(Math.min((editor.docW * 0.5) / img.width!, (editor.docH * 0.5) / img.height!));
          }
          canvas.add(img);
        } catch { /* unsupported media (wmf/emf) — skip */ }
      }

      // text shapes
      let stackY = 40;
      await ensureFont('Inter');
      for (const sp of Array.from(xml.getElementsByTagName('p:sp'))) {
        const body = sp.getElementsByTagName('p:txBody')[0];
        if (!body) continue;
        const paragraphs: { text: string; size: number; bold: boolean; color: string }[] = [];
        for (const p of Array.from(body.getElementsByTagName('a:p'))) {
          const texts = Array.from(p.getElementsByTagName('a:t')).map((t) => t.textContent ?? '');
          if (!texts.join('').trim()) continue;
          const rPr = p.getElementsByTagName('a:rPr')[0];
          const sz = rPr?.getAttribute('sz');
          const clr = rPr?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val');
          paragraphs.push({
            text: texts.join(''),
            size: sz ? (+sz / 100) * (96 / 72) * fit : 24 * fit,
            bold: rPr?.getAttribute('b') === '1',
            color: clr ? `#${clr}` : '#1a1a1a',
          });
        }
        if (!paragraphs.length) continue;
        const pos = readXfrm(sp, fit);
        const first = paragraphs[0];
        const tb = new fabric.Textbox(paragraphs.map((p) => p.text).join('\n'), {
          left: pos ? pos.x : 60,
          top: pos ? pos.y : stackY,
          width: pos ? Math.max(40, pos.w) : editor.docW * 0.7,
          fontSize: Math.max(8, first.size),
          fontWeight: first.bold ? 700 : 400,
          fill: first.color,
          fontFamily: 'Inter',
        });
        canvas.add(tb);
        if (!pos) stackY += tb.height! + 20;
      }
      canvas.requestRenderAll();
      }, pageId);
    }
    editor.setActivePage(editor.pages[0].id);
    toast(`Imported ${slideNames.length} slide${slideNames.length > 1 ? 's' : ''} from ${name}.`);
  } catch (err) {
    console.error(err);
    toast('Could not read that PPTX file.', 'error');
  } finally {
    editor.setBusy(null);
  }
}

function readXfrm(el: Element, fit: number): { x: number; y: number; w: number; h: number } | null {
  const xfrm = el.getElementsByTagName('a:xfrm')[0];
  const off = xfrm?.getElementsByTagName('a:off')[0];
  const ext = xfrm?.getElementsByTagName('a:ext')[0];
  if (!off || !ext) return null;
  return {
    x: (+off.getAttribute('x')! / EMU_PER_PX) * fit,
    y: (+off.getAttribute('y')! / EMU_PER_PX) * fit,
    w: (+ext.getAttribute('cx')! / EMU_PER_PX) * fit,
    h: (+ext.getAttribute('cy')! / EMU_PER_PX) * fit,
  };
}

// ---------------------------------------------------------------- HTML

export async function importHTML(html: string): Promise<void> {
  editor.setBusy('Importing HTML…');
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const canvas = editor.activeCanvas;
    if (!canvas) return;
    let y = 48;
    const margin = 48;
    const maxW = editor.docW - margin * 2;
    await ensureFont('Inter');

    const sizeFor = (tag: string): { size: number; weight: number } => {
      switch (tag) {
        case 'h1': return { size: 42, weight: 700 };
        case 'h2': return { size: 34, weight: 700 };
        case 'h3': return { size: 28, weight: 600 };
        case 'h4': return { size: 24, weight: 600 };
        default: return { size: 18, weight: 400 };
      }
    };

    const walk = async (el: Element): Promise<void> => {
      for (const node of Array.from(el.children)) {
        const tag = node.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style') continue;
        if (tag === 'img') {
          const src = node.getAttribute('src') ?? '';
          let url: string | null = null;
          if (src.startsWith('data:')) url = src;
          else if (src) {
            try {
              const res = await fetch(src);
              url = await blobToDataURL(await res.blob());
            } catch {
              toast(`Skipped remote image ${src.slice(0, 60)} (blocked by CORS).`, 'error');
            }
          }
          if (url) {
            try {
              const img = await fabric.FabricImage.fromURL(url);
              const s = Math.min(maxW / img.width!, 1);
              img.scale(s);
              img.set({ left: margin, top: y });
              canvas.add(img);
              y += img.getScaledHeight() + 24;
            } catch { /* bad image */ }
          }
          continue;
        }
        const hasElementChildren = node.children.length > 0 && tag !== 'p' && !/^h[1-6]$/.test(tag) && tag !== 'li';
        if (hasElementChildren) {
          await walk(node);
          continue;
        }
        const text = (node.textContent ?? '').trim().replace(/\s+/g, ' ');
        if (!text) continue;
        const { size, weight } = sizeFor(tag);
        const tb = new fabric.Textbox(tag === 'li' ? `• ${text}` : text, {
          left: margin, top: y, width: maxW,
          fontSize: size, fontWeight: weight, fontFamily: 'Inter', fill: '#1a1a1a',
        });
        canvas.add(tb);
        y += tb.height! + 18;
      }
    };
    await editor.batch(async () => {
      if (doc.body) await walk(doc.body);
      canvas.requestRenderAll();
    });
    toast('HTML imported — images and text are now editable objects.');
  } catch (err) {
    console.error(err);
    toast('Could not import that HTML file.', 'error');
  } finally {
    editor.setBusy(null);
  }
}
