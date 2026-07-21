// Image metadata (EXIF for JPEG, text chunks for PNG) — all in-browser.
// Reading, editing and stripping never re-encode pixels: JPEG operations
// splice APP segments, PNG operations rebuild the chunk list. Also holds the
// persisted "write this metadata into my downloads" settings used by the
// exporters.

import * as piexif from 'piexif-ts';

const { ImageIFD, ExifIFD, GPSIFD } = piexif.TagValues;

// ---------------------------------------------------------------- types

export type MetaGroup = 'camera' | 'photo' | 'gps' | 'message' | 'other';

export interface MetaField {
  key: string;
  label: string;
  value: string;
  group: MetaGroup;
  /** true = this field can identify a person, place or device */
  trackable: boolean;
}

/** The editable subset. Empty string / undefined means "absent". */
export interface MetaValues {
  make?: string;
  model?: string;
  software?: string;
  artist?: string;
  copyright?: string;
  dateTaken?: string; // EXIF format 'YYYY:MM:DD HH:MM:SS'
  description?: string;
  gpsLat?: number | null;
  gpsLon?: number | null;
  message?: string;
}

export interface ReadResult {
  format: 'jpeg' | 'png' | 'other';
  fields: MetaField[];
  editable: MetaValues;
  hasTrackable: boolean;
}

// ---------------------------------------------------------------- bytes

async function blobToBinaryString(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    s += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return s;
}

function binaryStringToBlob(bin: string, mime: string): Blob {
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function dataURLToBinaryString(url: string): string {
  return atob(url.split(',')[1]);
}

const utf8ToBinary = (s: string): string => unescape(encodeURIComponent(s));
const binaryToUtf8 = (b: string): string => {
  try { return decodeURIComponent(escape(b)); } catch { return b; }
};

// ---------------------------------------------------------------- dates & GPS

/** EXIF 'YYYY:MM:DD HH:MM:SS' -> datetime-local 'YYYY-MM-DDTHH:MM' (or '' if odd). */
export function exifDateToInput(v: string): string {
  const m = v.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : '';
}

/** datetime-local -> EXIF date string. */
export function inputDateToExif(v: string): string {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:00` : '';
}

function dmsToDeg(dms: unknown, ref: unknown): number | null {
  if (!Array.isArray(dms) || dms.length === 0) return null;
  let deg = 0;
  const div = [1, 60, 3600];
  for (let i = 0; i < Math.min(3, dms.length); i++) {
    const pair = dms[i];
    if (!Array.isArray(pair) || !pair[1]) continue; // zero-denominator guard
    deg += (pair[0] / pair[1]) / div[i];
  }
  if (!Number.isFinite(deg) || deg > 180.001) return null;
  return ref === 'S' || ref === 'W' ? -deg : deg;
}

// ---------------------------------------------------------------- UserComment

const ASCII_PREFIX = 'ASCII\0\0\0';
const UNICODE_PREFIX = 'UNICODE\0';

function encodeUserComment(msg: string): string {
  return ASCII_PREFIX + utf8ToBinary(msg);
}

function decodeUserComment(raw: string): string {
  if (raw.startsWith(ASCII_PREFIX)) return binaryToUtf8(raw.slice(8));
  if (raw.startsWith(UNICODE_PREFIX)) {
    const body = raw.slice(8);
    let out = '';
    for (let i = 0; i + 1 < body.length; i += 2) {
      out += String.fromCharCode(body.charCodeAt(i) * 256 + body.charCodeAt(i + 1));
    }
    return out;
  }
  if (/^\0{8}/.test(raw)) return binaryToUtf8(raw.slice(8));
  return binaryToUtf8(raw);
}

// ---------------------------------------------------------------- JPEG read

const cleanAscii = (v: unknown): string =>
  typeof v === 'string' ? v.replace(/\0+$/, '').trim() : '';

function rationalStr(v: unknown): string {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') {
    if (!v[1]) return '';
    const n = v[0] / v[1];
    return n < 1 && n > 0 ? `1/${Math.round(v[1] / v[0])}` : String(Math.round(n * 100) / 100);
  }
  return typeof v === 'number' ? String(v) : '';
}

function readJpegMeta(bin: string): { fields: MetaField[]; editable: MetaValues } {
  const fields: MetaField[] = [];
  const editable: MetaValues = {};
  let exif: piexif.IExif;
  try {
    exif = piexif.load(bin);
  } catch {
    return { fields, editable };
  }
  const zeroth = exif['0th'] ?? {};
  const exifIFD = exif.Exif ?? {};
  const gps = exif.GPS ?? {};
  const used = new Set<string>();
  const add = (
    group: MetaGroup, key: string, label: string, value: string, trackable = false,
  ) => {
    if (value) fields.push({ key, label, value, group, trackable });
  };
  const take = (ifd: piexif.IExifElement, ifdName: string, tag: number): unknown => {
    used.add(`${ifdName}:${tag}`);
    return ifd[tag];
  };

  // camera
  editable.make = cleanAscii(take(zeroth, '0th', ImageIFD.Make));
  editable.model = cleanAscii(take(zeroth, '0th', ImageIFD.Model));
  editable.software = cleanAscii(take(zeroth, '0th', ImageIFD.Software));
  add('camera', 'make', 'Camera make', editable.make, true);
  add('camera', 'model', 'Camera model', editable.model, true);
  add('camera', 'software', 'Software', editable.software);
  add('camera', 'lens', 'Lens', cleanAscii(take(exifIFD, 'Exif', ExifIFD.LensModel)));
  add('camera', 'serial', 'Serial number', cleanAscii(take(exifIFD, 'Exif', ExifIFD.BodySerialNumber)), true);

  // photo
  const dateOriginal = cleanAscii(take(exifIFD, 'Exif', ExifIFD.DateTimeOriginal));
  const dateZeroth = cleanAscii(take(zeroth, '0th', ImageIFD.DateTime));
  editable.dateTaken = dateOriginal || dateZeroth;
  used.add(`Exif:${ExifIFD.DateTimeDigitized}`);
  editable.artist = cleanAscii(take(zeroth, '0th', ImageIFD.Artist));
  editable.copyright = cleanAscii(take(zeroth, '0th', ImageIFD.Copyright));
  editable.description = cleanAscii(take(zeroth, '0th', ImageIFD.ImageDescription));
  add('photo', 'dateTaken', 'Date taken', editable.dateTaken, true);
  add('photo', 'artist', 'Author / artist', editable.artist, true);
  add('photo', 'copyright', 'Copyright', editable.copyright);
  add('photo', 'description', 'Description', editable.description);
  const exposure = rationalStr(take(exifIFD, 'Exif', ExifIFD.ExposureTime));
  add('photo', 'exposure', 'Exposure', exposure ? `${exposure} s` : '');
  const fnum = rationalStr(take(exifIFD, 'Exif', ExifIFD.FNumber));
  add('photo', 'fnumber', 'Aperture', fnum ? `f/${fnum}` : '');
  const iso = take(exifIFD, 'Exif', ExifIFD.ISOSpeedRatings);
  add('photo', 'iso', 'ISO', iso ? String(Array.isArray(iso) ? iso[0] : iso) : '');
  const focal = rationalStr(take(exifIFD, 'Exif', ExifIFD.FocalLength));
  add('photo', 'focal', 'Focal length', focal ? `${focal} mm` : '');

  // gps
  const lat = dmsToDeg(take(gps, 'GPS', GPSIFD.GPSLatitude), take(gps, 'GPS', GPSIFD.GPSLatitudeRef));
  const lon = dmsToDeg(take(gps, 'GPS', GPSIFD.GPSLongitude), take(gps, 'GPS', GPSIFD.GPSLongitudeRef));
  if (lat != null && lon != null) {
    editable.gpsLat = Math.round(lat * 1e6) / 1e6;
    editable.gpsLon = Math.round(lon * 1e6) / 1e6;
    add('gps', 'gps', 'GPS location', `${editable.gpsLat}, ${editable.gpsLon}`, true);
  }
  add('gps', 'gpsDate', 'GPS date', cleanAscii(take(gps, 'GPS', GPSIFD.GPSDateStamp)), true);
  const alt = rationalStr(take(gps, 'GPS', GPSIFD.GPSAltitude));
  add('gps', 'gpsAlt', 'Altitude', alt ? `${alt} m` : '', true);
  used.add(`GPS:${GPSIFD.GPSVersionID}`).add(`GPS:${GPSIFD.GPSTimeStamp}`);

  // hidden message
  const rawComment = take(exifIFD, 'Exif', ExifIFD.UserComment);
  if (typeof rawComment === 'string' && rawComment) {
    editable.message = decodeUserComment(rawComment).replace(/\0+$/, '').trim();
    add('message', 'message', 'Hidden message', editable.message);
  }

  // everything else, labeled via the tag dictionary
  const dump = (ifd: piexif.IExifElement, ifdName: '0th' | 'Exif' | 'GPS') => {
    for (const k of Object.keys(ifd)) {
      const tag = Number(k);
      if (used.has(`${ifdName}:${tag}`)) continue;
      if (tag === 37500 || tag === 700) continue; // MakerNote / XMP blobs — huge, unreadable
      if (ifdName === '0th' && (tag === 34665 || tag === 34853 || tag === 40965)) continue; // internal IFD pointers
      const info = (piexif.Tags as unknown as Record<string, Record<number, { name: string }>>)[ifdName]?.[tag];
      let v = ifd[tag];
      if (typeof v !== 'string' && typeof v !== 'number') v = JSON.stringify(v);
      let s = cleanAscii(String(v)) || String(v);
      if (s.length > 60) s = `${s.slice(0, 57)}…`;
      if (!/[^\s]/.test(s)) continue;
      fields.push({
        key: `${ifdName}-${tag}`,
        label: info?.name ?? `Tag 0x${tag.toString(16)}`,
        value: s,
        group: 'other',
        trackable: false,
      });
    }
  };
  dump(zeroth, '0th');
  dump(exifIFD, 'Exif');
  dump(gps, 'GPS');
  return { fields, editable };
}

// ---------------------------------------------------------------- JPEG write

/** Build the merged EXIF object: empty value = tag removed. */
function mergeExif(base: piexif.IExif, v: MetaValues): piexif.IExif {
  const zeroth: piexif.IExifElement = { ...(base['0th'] ?? {}) };
  const exifIFD: piexif.IExifElement = { ...(base.Exif ?? {}) };
  const gps: piexif.IExifElement = { ...(base.GPS ?? {}) };
  const setOrDelete = (ifd: piexif.IExifElement, tag: number, val: string | undefined) => {
    if (val) ifd[tag] = val;
    else delete ifd[tag];
  };
  setOrDelete(zeroth, ImageIFD.Make, v.make);
  setOrDelete(zeroth, ImageIFD.Model, v.model);
  setOrDelete(zeroth, ImageIFD.Software, v.software);
  setOrDelete(zeroth, ImageIFD.Artist, v.artist);
  setOrDelete(zeroth, ImageIFD.Copyright, v.copyright);
  setOrDelete(zeroth, ImageIFD.ImageDescription, v.description);
  setOrDelete(zeroth, ImageIFD.DateTime, v.dateTaken);
  setOrDelete(exifIFD, ExifIFD.DateTimeOriginal, v.dateTaken);
  setOrDelete(exifIFD, ExifIFD.DateTimeDigitized, v.dateTaken);
  setOrDelete(exifIFD, ExifIFD.UserComment, v.message ? encodeUserComment(v.message.slice(0, 32000)) : undefined);
  const lat = v.gpsLat, lon = v.gpsLon;
  if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    gps[GPSIFD.GPSVersionID] = [2, 3, 0, 0];
    gps[GPSIFD.GPSLatitudeRef] = lat >= 0 ? 'N' : 'S';
    gps[GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(Math.abs(lat));
    gps[GPSIFD.GPSLongitudeRef] = lon >= 0 ? 'E' : 'W';
    gps[GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(Math.abs(lon));
  } else {
    delete gps[GPSIFD.GPSLatitudeRef];
    delete gps[GPSIFD.GPSLatitude];
    delete gps[GPSIFD.GPSLongitudeRef];
    delete gps[GPSIFD.GPSLongitude];
  }
  return { '0th': zeroth, Exif: exifIFD, GPS: gps, '1st': base['1st'], thumbnail: base.thumbnail };
}

/** Write metadata into a freshly exported JPEG dataURL. Returns a dataURL. */
export function writeJpegMeta(jpegDataURL: string, v: MetaValues): string {
  const bin = dataURLToBinaryString(jpegDataURL);
  const exifBytes = piexif.dump(mergeExif({}, v));
  return `data:image/jpeg;base64,${btoa(piexif.insert(exifBytes, bin))}`;
}

/** Merge edits into an existing photo (unrelated tags kept, pixels untouched). */
export async function applyJpegMeta(blob: Blob, v: MetaValues): Promise<Blob> {
  const bin = await blobToBinaryString(blob);
  let base: piexif.IExif = {};
  try { base = piexif.load(bin); } catch { /* no existing EXIF — start clean */ }
  const exifBytes = piexif.dump(mergeExif(base, v));
  return binaryStringToBlob(piexif.insert(exifBytes, piexif.remove(bin)), 'image/jpeg');
}

/**
 * Remove all metadata segments from a JPEG (EXIF, XMP, IPTC, comments) with a
 * plain segment walk — pixel data and the JFIF/ICC segments are untouched.
 */
export async function stripJpegMeta(blob: Blob): Promise<Blob> {
  const bin = await blobToBinaryString(blob);
  if (bin.charCodeAt(0) !== 0xff || bin.charCodeAt(1) !== 0xd8) return blob;
  let out = '\xff\xd8';
  let i = 2;
  while (i + 4 <= bin.length) {
    if (bin.charCodeAt(i) !== 0xff) return blob; // malformed — leave untouched
    const marker = bin.charCodeAt(i + 1);
    if (marker === 0xda) return binaryStringToBlob(out + bin.slice(i), 'image/jpeg'); // SOS: rest is pixels
    const len = bin.charCodeAt(i + 2) * 256 + bin.charCodeAt(i + 3);
    // drop APP1 (EXIF/XMP), APP13 (IPTC/Photoshop) and COM; keep everything else
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) out += bin.slice(i, i + 2 + len);
    i += 2 + len;
  }
  return blob;
}

// ---------------------------------------------------------------- PNG chunks

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface PngChunk { type: string; data: Uint8Array }

function parsePngChunks(bytes: Uint8Array): PngChunk[] | null {
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return null;
  const chunks: PngChunk[] = [];
  let i = 8;
  while (i + 8 <= bytes.length) {
    const len = (bytes[i] << 24 | bytes[i + 1] << 16 | bytes[i + 2] << 8 | bytes[i + 3]) >>> 0;
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    if (i + 12 + len > bytes.length) return null;
    chunks.push({ type, data: bytes.subarray(i + 8, i + 8 + len) });
    i += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

function buildPng(chunks: PngChunk[]): Blob {
  let total = 8;
  for (const c of chunks) total += 12 + c.data.length;
  const out = new Uint8Array(total);
  out.set(PNG_SIG, 0);
  let i = 8;
  for (const c of chunks) {
    const len = c.data.length;
    out[i] = len >>> 24; out[i + 1] = (len >>> 16) & 0xff; out[i + 2] = (len >>> 8) & 0xff; out[i + 3] = len & 0xff;
    const typed = new Uint8Array(4 + len);
    for (let k = 0; k < 4; k++) typed[k] = c.type.charCodeAt(k);
    typed.set(c.data, 4);
    out.set(typed, i + 4);
    const crc = crc32(typed);
    const ci = i + 8 + len;
    out[ci] = crc >>> 24; out[ci + 1] = (crc >>> 16) & 0xff; out[ci + 2] = (crc >>> 8) & 0xff; out[ci + 3] = crc & 0xff;
    i += 12 + len;
  }
  return new Blob([out], { type: 'image/png' });
}

function makeTextChunk(keyword: string, text: string): PngChunk {
  const latin1Ok = [...text].every((ch) => ch.charCodeAt(0) <= 255);
  if (latin1Ok) {
    const data = new Uint8Array(keyword.length + 1 + text.length);
    let i = 0;
    for (const ch of keyword) data[i++] = ch.charCodeAt(0);
    data[i++] = 0;
    for (const ch of text) data[i++] = ch.charCodeAt(0);
    return { type: 'tEXt', data };
  }
  // iTXt: keyword \0 compFlag(0) compMethod(0) lang \0 translated \0 utf8
  const utf8 = utf8ToBinary(text);
  const data = new Uint8Array(keyword.length + 5 + utf8.length);
  let i = 0;
  for (const ch of keyword) data[i++] = ch.charCodeAt(0);
  data[i++] = 0; data[i++] = 0; data[i++] = 0; data[i++] = 0; data[i++] = 0;
  for (const ch of utf8) data[i++] = ch.charCodeAt(0);
  return { type: 'iTXt', data };
}

const PNG_KEYWORDS: [keyof MetaValues, string][] = [
  ['make', 'Make'],
  ['model', 'Model'],
  ['software', 'Software'],
  ['artist', 'Author'],
  ['copyright', 'Copyright'],
  ['dateTaken', 'Creation Time'],
  ['description', 'Description'],
  ['message', 'Comment'],
];

/** Write metadata text chunks into a freshly exported PNG dataURL. */
export function writePngMeta(pngDataURL: string, v: MetaValues): Blob {
  const bin = dataURLToBinaryString(pngDataURL);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const chunks = parsePngChunks(bytes);
  if (!chunks) return new Blob([bytes], { type: 'image/png' });
  const fresh: PngChunk[] = [];
  for (const [key, keyword] of PNG_KEYWORDS) {
    const val = v[key];
    if (typeof val === 'string' && val) fresh.push(makeTextChunk(keyword, val.slice(0, 32000)));
  }
  const ihdrIdx = chunks.findIndex((c) => c.type === 'IHDR');
  chunks.splice(ihdrIdx + 1, 0, ...fresh);
  return buildPng(chunks);
}

function readPngMeta(bytes: Uint8Array): { fields: MetaField[]; editable: MetaValues } {
  const fields: MetaField[] = [];
  const editable: MetaValues = {};
  const chunks = parsePngChunks(bytes) ?? [];
  const latin1 = (d: Uint8Array) => String.fromCharCode(...d);
  const backMap = new Map(PNG_KEYWORDS.map(([k, kw]) => [kw, k]));
  const groupFor: Partial<Record<keyof MetaValues, MetaGroup>> = {
    make: 'camera', model: 'camera', software: 'camera',
    artist: 'photo', copyright: 'photo', dateTaken: 'photo', description: 'photo',
    message: 'message',
  };
  const labelFor: Partial<Record<keyof MetaValues, string>> = {
    make: 'Camera make', model: 'Camera model', software: 'Software',
    artist: 'Author / artist', copyright: 'Copyright', dateTaken: 'Date taken',
    description: 'Description', message: 'Hidden message',
  };
  for (const c of chunks) {
    let keyword = '', text = '';
    if (c.type === 'tEXt') {
      const nul = c.data.indexOf(0);
      if (nul < 1) continue;
      keyword = latin1(c.data.subarray(0, nul));
      text = latin1(c.data.subarray(nul + 1));
    } else if (c.type === 'iTXt') {
      const nul = c.data.indexOf(0);
      if (nul < 1 || c.data[nul + 1] !== 0) continue; // skip compressed iTXt
      keyword = latin1(c.data.subarray(0, nul));
      let p = nul + 3; // skip comp flag + method
      p = c.data.indexOf(0, p) + 1;   // skip language tag
      p = c.data.indexOf(0, p) + 1;   // skip translated keyword
      if (p <= 0) continue;
      text = binaryToUtf8(latin1(c.data.subarray(p)));
    } else if (c.type === 'tIME' && c.data.length >= 7) {
      const y = c.data[0] * 256 + c.data[1];
      fields.push({
        key: 'png-time', label: 'Last modified', group: 'photo', trackable: true,
        value: `${y}-${String(c.data[2]).padStart(2, '0')}-${String(c.data[3]).padStart(2, '0')}`,
      });
      continue;
    } else {
      continue;
    }
    if (!text.trim()) continue;
    const key = backMap.get(keyword);
    if (key) {
      (editable as Record<string, unknown>)[key] = text;
      fields.push({
        key, label: labelFor[key]!, value: text, group: groupFor[key]!,
        trackable: key === 'make' || key === 'model' || key === 'artist' || key === 'dateTaken',
      });
    } else {
      fields.push({
        key: `png-${keyword}`, label: keyword,
        value: text.length > 60 ? `${text.slice(0, 57)}…` : text,
        group: keyword.toLowerCase() === 'comment' ? 'message' : 'other',
        trackable: false,
      });
    }
  }
  return { fields, editable };
}

/** Rebuild a PNG without any text/metadata chunks (pixels untouched). */
export async function stripPngMeta(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks = parsePngChunks(bytes);
  if (!chunks) return blob;
  const DROP = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);
  return buildPng(chunks.filter((c) => !DROP.has(c.type)));
}

/** Rewrite a PNG's metadata: strip existing text chunks, write the new values. */
export async function applyPngMeta(blob: Blob, v: MetaValues): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks = parsePngChunks(bytes);
  if (!chunks) return blob;
  const DROP = new Set(['tEXt', 'iTXt', 'zTXt']);
  const kept = chunks.filter((c) => !DROP.has(c.type));
  const fresh: PngChunk[] = [];
  for (const [key, keyword] of PNG_KEYWORDS) {
    const val = v[key];
    if (typeof val === 'string' && val) fresh.push(makeTextChunk(keyword, val.slice(0, 32000)));
  }
  const ihdrIdx = kept.findIndex((c) => c.type === 'IHDR');
  kept.splice(ihdrIdx + 1, 0, ...fresh);
  return buildPng(kept);
}

// ---------------------------------------------------------------- readMeta

export async function readMeta(blob: Blob): Promise<ReadResult> {
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const isJpeg = head[0] === 0xff && head[1] === 0xd8;
  const isPng = PNG_SIG.every((b, i) => head[i] === b);
  let format: ReadResult['format'] = 'other';
  let fields: MetaField[] = [];
  let editable: MetaValues = {};
  if (isJpeg) {
    format = 'jpeg';
    ({ fields, editable } = readJpegMeta(await blobToBinaryString(blob)));
  } else if (isPng) {
    format = 'png';
    ({ fields, editable } = readPngMeta(new Uint8Array(await blob.arrayBuffer())));
  }
  const order: MetaGroup[] = ['message', 'gps', 'camera', 'photo', 'other'];
  fields.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  return { format, fields, editable, hasTrackable: fields.some((f) => f.trackable) };
}

// ---------------------------------------------------------------- export settings

export interface ExportMetaSettings {
  enabled: boolean;
  values: MetaValues;
}

const SETTINGS_KEY = 'oc-export-meta';
let settingsCache: ExportMetaSettings | null = null;

export function getExportMeta(): ExportMetaSettings {
  if (!settingsCache) {
    settingsCache = { enabled: false, values: {} };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ExportMetaSettings;
        if (parsed && typeof parsed.enabled === 'boolean') {
          settingsCache = { enabled: parsed.enabled, values: parsed.values ?? {} };
        }
      }
    } catch { /* corrupted or unavailable storage — defaults are fine */ }
  }
  return settingsCache;
}

export function setExportMeta(s: ExportMetaSettings): void {
  settingsCache = s;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export function hasAnyMetaValue(v: MetaValues): boolean {
  return Boolean(
    v.make || v.model || v.software || v.artist || v.copyright || v.dateTaken
    || v.description || v.message || (v.gpsLat != null && v.gpsLon != null),
  );
}

function plainDataURLToBlob(url: string): Blob {
  const [head, body] = url.split(',');
  const mime = head.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream';
  return binaryStringToBlob(atob(body), mime);
}

/**
 * The single hook the exporters call: turn a freshly rendered dataURL into the
 * download Blob, writing the user's chosen metadata when (and only when) the
 * feature is enabled. With it disabled the output is byte-identical to before.
 */
export function applyExportMeta(dataURL: string, format: 'jpg' | 'png'): Blob {
  const s = getExportMeta();
  if (!s.enabled || !hasAnyMetaValue(s.values)) return plainDataURLToBlob(dataURL);
  try {
    if (format === 'jpg') return plainDataURLToBlob(writeJpegMeta(dataURL, s.values));
    return writePngMeta(dataURL, s.values);
  } catch (err) {
    console.error('metadata write failed, saving clean file', err);
    return plainDataURLToBlob(dataURL);
  }
}
