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

export async function importProject(file: File | Blob): Promise<void> {
  editor.setBusy('Opening project…');
  try {
    const zip = await JSZip.loadAsync(file);
    const designText = await zip.file('design.json')?.async('text');
    const design = designText ? JSON.parse(designText) : null;
    if (!design || design.app !== 'opencanvas' || !Array.isArray(design.pages)) {
      toast('That file is not an OpenCanvas project.', 'error');
      return;
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
    editor.hydrate({
      name: typeof design.name === 'string' && design.name.trim() ? design.name : 'Untitled design',
      docW: clampSize(design.docW, 1280),
      docH: clampSize(design.docH, 720),
      pages: design.pages.map((p: unknown) => JSON.stringify(p)),
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

/** Import with a guard: opening replaces whatever is on the canvas now. */
export async function confirmAndImportProject(file: File): Promise<void> {
  if (!editor.isFresh() && !window.confirm('Opening a project replaces your current design. Continue?')) return;
  await importProject(file);
}

/** Prompt for a .opencanvas file and open it. */
export function openProjectDialog(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = `${PROJECT_EXT},.zip`;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void confirmAndImportProject(file);
  };
  input.click();
}
