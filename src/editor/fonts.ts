// Font management. Three sources:
//  - the built-in Google Fonts list (preloaded via <link> in index.html)
//  - user-added Google Fonts, fetched by name on demand (persisted in localStorage)
//  - uploaded font files, registered with the FontFace API (persisted in IndexedDB)

import { GOOGLE_FONTS, SYSTEM_FONTS } from '../constants';
import { kvGet, kvSet } from './db';

const LS_GOOGLE = 'oc-google-fonts';
const KV_USER = 'userFonts';

export interface StoredUserFont { name: string; data: Blob }

export let customGoogleFonts: string[] = [];
export let userFonts: string[] = [];

export function allFonts(): string[] {
  return [...new Set([...GOOGLE_FONTS, ...SYSTEM_FONTS, ...customGoogleFonts, ...userFonts])]
    .sort((a, b) => a.localeCompare(b));
}

export function customFonts(): string[] {
  return [...new Set([...customGoogleFonts, ...userFonts])].sort((a, b) => a.localeCompare(b));
}

const loadedFonts = new Set<string>();

/** Make sure a non-system font is actually loaded before fabric renders it. */
export async function ensureFont(family: string): Promise<void> {
  if (loadedFonts.has(family)) return;
  if (!GOOGLE_FONTS.includes(family) && !customGoogleFonts.includes(family) && !userFonts.includes(family)) return;
  try {
    await Promise.all([
      document.fonts.load(`16px "${family}"`),
      document.fonts.load(`bold 16px "${family}"`),
      document.fonts.load(`italic 16px "${family}"`),
    ]);
  } catch { /* font may not exist in a weight — fine */ }
  loadedFonts.add(family);
}

function googleCssUrls(family: string): string[] {
  const enc = encodeURIComponent(family).replace(/%20/g, '+');
  return [
    // try a rich weight set first; fonts without those weights 400 the request,
    // so fall back to the plain (regular-only) form
    `https://fonts.googleapis.com/css2?family=${enc}:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap`,
    `https://fonts.googleapis.com/css2?family=${enc}&display=swap`,
  ];
}

async function fetchGoogleCss(family: string): Promise<string | null> {
  for (const url of googleCssUrls(family)) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch { /* offline or blocked — try the next form */ }
  }
  return null;
}

function injectCss(family: string, css: string): void {
  const marker = family.replace(/"/g, '');
  if (document.querySelector(`style[data-oc-font="${marker}"]`)) return;
  const style = document.createElement('style');
  style.dataset.ocFont = marker;
  style.textContent = css;
  document.head.appendChild(style);
}

const titleCase = (s: string) => s.toLowerCase().replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1));

function persistGoogle(): void {
  try { localStorage.setItem(LS_GOOGLE, JSON.stringify(customGoogleFonts)); } catch { /* private mode */ }
}

/**
 * Add any font from Google Fonts by name (as typed, then title-cased).
 * Returns the canonical family name, or null if Google doesn't have it.
 */
export async function addGoogleFont(rawName: string): Promise<string | null> {
  const typed = rawName.trim().replace(/\s+/g, ' ');
  if (!typed) return null;
  const existing = allFonts().find((f) => f.toLowerCase() === typed.toLowerCase());
  if (existing) {
    await ensureFont(existing);
    return existing;
  }
  for (const candidate of [...new Set([typed, titleCase(typed)])]) {
    const css = await fetchGoogleCss(candidate);
    if (!css) continue;
    const canonical = css.match(/font-family:\s*'([^']+)'/)?.[1] ?? candidate;
    injectCss(canonical, css);
    try { await document.fonts.load(`16px "${canonical}"`); } catch { /* best effort */ }
    if (!customGoogleFonts.includes(canonical)) {
      customGoogleFonts.push(canonical);
      persistGoogle();
    }
    loadedFonts.add(canonical);
    return canonical;
  }
  return null;
}

/** Register a font blob under a family name; optionally persist it. */
export async function addUserFontBlob(name: string, blob: Blob, persist = true): Promise<string | null> {
  try {
    const face = new FontFace(name, await blob.arrayBuffer());
    await face.load();
    document.fonts.add(face);
  } catch {
    return null;
  }
  if (!userFonts.includes(name)) userFonts.push(name);
  loadedFonts.add(name);
  if (persist) {
    try {
      const list = (await kvGet<StoredUserFont[]>(KV_USER)) ?? [];
      if (!list.some((f) => f.name === name)) {
        list.push({ name, data: blob });
        await kvSet(KV_USER, list);
      }
    } catch { /* storage unavailable — font still works this session */ }
  }
  return name;
}

/** Register an uploaded .ttf/.otf/.woff/.woff2 file as a usable font. */
export async function addUserFontFile(file: File): Promise<string | null> {
  const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Custom font';
  return addUserFontBlob(name, file);
}

export async function userFontRecords(): Promise<StoredUserFont[]> {
  try { return (await kvGet<StoredUserFont[]>(KV_USER)) ?? []; } catch { return []; }
}

export async function removeCustomFont(name: string): Promise<void> {
  if (customGoogleFonts.includes(name)) {
    customGoogleFonts = customGoogleFonts.filter((f) => f !== name);
    persistGoogle();
  }
  if (userFonts.includes(name)) {
    userFonts = userFonts.filter((f) => f !== name);
    try {
      const list = (await kvGet<StoredUserFont[]>(KV_USER)) ?? [];
      await kvSet(KV_USER, list.filter((f) => f.name !== name));
    } catch { /* ignore */ }
  }
}

/** Re-register persisted custom fonts on startup. */
export async function initFonts(): Promise<void> {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_GOOGLE) ?? '[]');
    customGoogleFonts = Array.isArray(stored) ? stored.filter((f) => typeof f === 'string') : [];
  } catch {
    customGoogleFonts = [];
  }
  for (const family of customGoogleFonts) {
    void fetchGoogleCss(family).then((css) => { if (css) injectCss(family, css); });
  }
  for (const rec of await userFontRecords()) {
    void addUserFontBlob(rec.name, rec.data, false);
  }
}
