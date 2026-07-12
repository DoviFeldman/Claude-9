// Save / open the whole design as a portable project file (.opencanvas).
// The file is a plain zip: design.json (canvas size, name, every page with each
// object's position/size/rotation/crop/colors) + images/ (every bitmap used,
// extracted from the fabric JSON) + fonts/ (uploaded font files). Reopening it
// here — on any machine — restores the design exactly, ready to keep editing.

import JSZip from 'jszip';
import { editor } from './Editor';
import { blobToDataURL } from './db';
import { dataURLToBlob, safeName, saveBlob } from './exporters';
import { addGoogleFont, addUserFontBlob, customGoogleFonts, userFontRecords } from './fonts';
import { gradientToSpec, specToGradient } from './gradients';
import { toast } from './toast';

export const PROJECT_EXT = '.opencanvas';
const ASSET_PREFIX = 'oc-asset://';
const BLANK_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function extFromDataURL(url: string): string {
  const mime = url.slice(5, url.indexOf(';'));
  const map: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/svg+xml': 'svg',
  };
  return map[mime] ?? 'png';
}

/** Walk a fabric object tree (including group children). */
function walkObjects(objs: unknown[], fn: (o: Record<string, unknown>) => void): void {
  for (const o of objs ?? []) {
    if (!o || typeof o !== 'object') continue;
    const node = o as Record<string, unknown>;
    fn(node);
    if (Array.isArray(node.objects)) walkObjects(node.objects, fn);
  }
}

export async function exportProject(): Promise<void> {
  editor.setBusy('Saving project…');
  try {
    const zip = new JSZip();
    const seen = new Map<string, string>(); // dataURL -> asset path
    let n = 0;
    const pages = editor.pages.map((p) => {
      const c = editor.getCanvas(p.id);
      const page = JSON.parse(c ? editor.serializePage(c) : '{"objects":[]}');
      walkObjects(page.objects, (o) => {
        if (typeof o.src === 'string' && o.src.startsWith('data:')) {
          let path = seen.get(o.src);
          if (!path) {
            path = `images/image-${++n}.${extFromDataURL(o.src)}`;
            seen.set(o.src, path);
            zip.file(path, dataURLToBlob(o.src));
          }
          o.src = ASSET_PREFIX + path;
        }
      });
      return page;
    });
    const userFontEntries: { name: string; file: string }[] = [];
    (await userFontRecords()).forEach((f, i) => {
      const path = `fonts/font-${i + 1}`;
      zip.file(path, f.data);
      userFontEntries.push({ name: f.name, file: path });
    });
    const design = {
      app: 'opencanvas',
      formatVersion: 1,
      name: editor.docName,
      docW: editor.docW,
      docH: editor.docH,
      pages,
      fonts: { google: [...customGoogleFonts], user: userFontEntries },
    };
    zip.file('design.json', JSON.stringify(design));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    saveBlob(blob, `${safeName()}${PROJECT_EXT}`);
    toast('Project saved. Open it here any time — or share the file so others can edit it.');
  } catch (err) {
    console.error(err);
    toast('Could not save the project file.', 'error');
  } finally {
    editor.setBusy(null);
  }
}

function clampSize(v: unknown, fallback: number): number {
  const num = Math.round(Number(v));
  return Number.isFinite(num) && num >= 16 && num <= 8000 ? num : fallback;
}

interface LoadedProject {
  name: string;
  docW: number;
  docH: number;
  pages: Record<string, unknown>[];
}

/** Read a project zip: validate, register its fonts, re-inline its images.
 *  Returns null (with a toast) if the file isn't a valid project. */
async function readProject(file: File | Blob): Promise<LoadedProject | null> {
  const zip = await JSZip.loadAsync(file).catch(() => null);
  const designText = zip ? await zip.file('design.json')?.async('text') : null;
  const design = designText ? JSON.parse(designText) : null;
  if (!zip || !design || design.app !== 'opencanvas' || !Array.isArray(design.pages)) {
    toast('That file is not an OpenCanvas project.', 'error');
    return null;
  }
  // fonts first, so text renders with the right faces as pages load
  for (const fam of design.fonts?.google ?? []) {
    if (typeof fam === 'string') {
      try { await addGoogleFont(fam); } catch { /* offline — text falls back */ }
    }
  }
  for (const f of design.fonts?.user ?? []) {
    const zf = typeof f?.file === 'string' ? zip.file(f.file) : null;
    if (zf && typeof f.name === 'string') await addUserFontBlob(f.name, await zf.async('blob'));
  }
  // re-inline extracted images
  const nodes: Record<string, unknown>[] = [];
  for (const page of design.pages) {
    if (Array.isArray(page?.objects)) walkObjects(page.objects, (o) => {
      if (typeof o.src === 'string' && o.src.startsWith(ASSET_PREFIX)) nodes.push(o);
    });
  }
  const cache = new Map<string, string>();
  for (const o of nodes) {
    const path = (o.src as string).slice(ASSET_PREFIX.length);
    let url = cache.get(path);
    if (!url) {
      const zf = zip.file(path);
      url = zf ? await blobToDataURL(await zf.async('blob')) : BLANK_PIXEL;
      cache.set(path, url);
    }
    o.src = url;
  }
  return {
    name: typeof design.name === 'string' && design.name.trim() ? design.name : 'Untitled design',
    docW: clampSize(design.docW, 1280),
    docH: clampSize(design.docH, 720),
    pages: design.pages.map((p: unknown) => (p && typeof p === 'object' ? p as Record<string, unknown> : { objects: [] })),
  };
}

export async function importProject(file: File | Blob): Promise<void> {
  editor.setBusy('Opening project…');
  try {
    const proj = await readProject(file);
    if (!proj) return;
    editor.hydrate({
      name: proj.name,
      docW: proj.docW,
      docH: proj.docH,
      pages: proj.pages.map((p) => JSON.stringify(p)),
      savedAt: Date.now(),
      lastVisit: Date.now(),
    });
    editor.zoomToFit();
    editor.scheduleSave();
    toast('Project opened.');
  } catch (err) {
    console.error(err);
    toast('Could not open that project file.', 'error');
  } finally {
    editor.setBusy(null);
  }
}

/** Scale a page's content from its source canvas size onto the current one:
 *  objects fit-scale around the page center, backgrounds refill the page. */
function fitPageJSON(page: Record<string, unknown>, srcW: number, srcH: number, dstW: number, dstH: number): void {
  if (srcW === dstW && srcH === dstH) return;
  const s = Math.min(dstW / srcW, dstH / srcH);
  const dx = (dstW - srcW * s) / 2;
  const dy = (dstH - srcH * s) / 2;
  for (const o of (page.objects as Record<string, unknown>[] | undefined) ?? []) {
    o.left = ((o.left as number) ?? 0) * s + dx;
    o.top = ((o.top as number) ?? 0) * s + dy;
    o.scaleX = ((o.scaleX as number) ?? 1) * s;
    o.scaleY = ((o.scaleY as number) ?? 1) * s;
  }
  // background gradients are sized in source-page pixels — rebuild for this page
  const spec = gradientToSpec(page.background);
  if (spec) page.background = specToGradient(spec, { units: 'pixels', w: dstW, h: dstH }).toObject();
}

/** Add a project's pages below the current ones, keeping the current design
 *  and canvas size (content from a different-sized project is fit-scaled). */
export async function appendProjectPages(file: File | Blob, sourceName = 'project'): Promise<void> {
  // on a blank document a full open is strictly better: it also restores
  // the project's name and canvas size, and leaves no empty first page
  if (editor.isFresh()) {
    await importProject(file);
    return;
  }
  editor.setBusy('Adding project pages…');
  try {
    const proj = await readProject(file);
    if (!proj) return;
    let firstNewId: string | null = null;
    for (const page of proj.pages) {
      fitPageJSON(page, proj.docW, proj.docH, editor.docW, editor.docH);
      const id = editor.addPage(editor.pages.length - 1, JSON.stringify(page), false);
      firstNewId = firstNewId ?? id;
    }
    if (firstNewId) editor.setActivePage(firstNewId);
    const n = proj.pages.length;
    const resized = proj.docW !== editor.docW || proj.docH !== editor.docH;
    toast(`Added ${n} page${n === 1 ? '' : 's'} from ${sourceName}${resized ? ' (scaled to fit this canvas)' : ''}.`);
  } catch (err) {
    console.error(err);
    toast('Could not read that project file.', 'error');
  } finally {
    editor.setBusy(null);
  }
}

/** Import with a guard: opening replaces whatever is on the canvas now. */
export async function confirmAndImportProject(file: File): Promise<void> {
  if (!editor.isFresh() && !window.confirm('Opening a project replaces your current design. Continue?')) return;
  await importProject(file);
}

/** Prompt for a .opencanvas file and open it. */
export function openProjectDialog(): void {
  const input = document.createElement('input');
  input.type = 'file';
  // No accept filter: pickers (especially on phones) don't recognize the
  // custom .opencanvas extension and grey the file out when restricted.
  // importProject validates the content and explains if it's not a project.
  input.style.display = 'none';
  // iOS Safari needs the input in the document, and a live reference until
  // the change event fires, or the callback can silently never run
  document.body.appendChild(input);
  const cleanup = () => input.remove();
  input.onchange = () => {
    const file = input.files?.[0];
    cleanup();
    if (file) void confirmAndImportProject(file);
  };
  input.oncancel = cleanup;
  input.click();
}
