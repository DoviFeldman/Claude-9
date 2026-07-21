// The big "Image metadata" dialog, opened from the Download menu.
// Tab 1 inspects/edits/strips real photos (pixels never re-encoded);
// Tab 2 chooses what metadata gets written into JPG/PNG downloads.

import { useEffect, useRef, useState } from 'react';
import { editor } from '../editor/Editor';
import { useEditor } from '../editor/useEditor';
import { uploadsAll, uploadGet, uploadPut, type UploadRecord } from '../editor/db';
import {
  applyJpegMeta, applyPngMeta, exifDateToInput, getExportMeta, hasAnyMetaValue,
  inputDateToExif, readMeta, setExportMeta, stripJpegMeta, stripPngMeta,
  type MetaField, type MetaGroup, type MetaValues, type ReadResult,
} from '../editor/exifmeta';
import { saveBlob } from '../editor/exporters';
import { toast } from '../editor/toast';
import { Icon } from './icons';

const GROUP_LABEL: Record<MetaGroup, string> = {
  message: 'Hidden message',
  gps: 'Location',
  camera: 'Camera & device',
  photo: 'Photo details',
  other: 'Everything else',
};

// ---------------------------------------------------------------- inspect tab

interface Source {
  name: string;
  blob: Blob;
  uploadId?: string; // set when it came from stored uploads
}

function FieldTable({ result }: { result: ReadResult }) {
  const groups: MetaGroup[] = ['message', 'gps', 'camera', 'photo', 'other'];
  const byGroup = new Map<MetaGroup, MetaField[]>();
  result.fields.forEach((f) => {
    byGroup.set(f.group, [...(byGroup.get(f.group) ?? []), f]);
  });
  if (result.fields.length === 0) {
    return (
      <div className="hint" style={{ marginTop: 4 }}>
        <b>No metadata found</b> — this file is clean. Nothing in it says where it
        was taken, when, or on what device.
      </div>
    );
  }
  return (
    <div className="meta-grid">
      {groups.map((g) => {
        const rows = byGroup.get(g);
        if (!rows) return null;
        return [
          <div key={g} className={`meta-group-head${g === 'message' ? ' fun' : ''}`}>
            {g === 'message' ? '🎉 Hidden message found!' : GROUP_LABEL[g]}
          </div>,
          ...rows.map((f) => (
            <div key={f.key} className="meta-row">
              <span className="meta-label">{f.label}</span>
              <span className="meta-value">{f.value}</span>
              {f.trackable
                ? <span className="meta-badge">can identify you</span>
                : <span className="meta-badge ok">normal</span>}
            </div>
          )),
        ];
      })}
    </div>
  );
}

function MetaForm({ draft, onChange, showGps }: {
  draft: MetaValues;
  onChange: (patch: Partial<MetaValues>) => void;
  showGps: boolean;
}) {
  const num = (s: string): number | null => {
    if (s.trim() === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  return (
    <div className="meta-form">
      <div className="meta-form-row">
        <label>
          Camera make — "taken on"
          <input value={draft.make ?? ''} placeholder="e.g. Banana Electronics" onChange={(e) => onChange({ make: e.target.value })} />
        </label>
        <label>
          Camera model
          <input value={draft.model ?? ''} placeholder="e.g. Banana Phone 3000" onChange={(e) => onChange({ model: e.target.value })} />
        </label>
      </div>
      <div className="meta-form-row">
        <label>
          Author / artist
          <input value={draft.artist ?? ''} onChange={(e) => onChange({ artist: e.target.value })} />
        </label>
        <label>
          Software
          <input value={draft.software ?? ''} placeholder="OpenCanvas" onChange={(e) => onChange({ software: e.target.value })} />
        </label>
      </div>
      <div className="meta-form-row">
        <label>
          Date taken
          <input
            type="datetime-local"
            value={draft.dateTaken ? exifDateToInput(draft.dateTaken) : ''}
            onChange={(e) => onChange({ dateTaken: e.target.value ? inputDateToExif(e.target.value) : '' })}
          />
        </label>
        <label>
          Copyright
          <input value={draft.copyright ?? ''} onChange={(e) => onChange({ copyright: e.target.value })} />
        </label>
      </div>
      <label>
        Description
        <input value={draft.description ?? ''} onChange={(e) => onChange({ description: e.target.value })} />
      </label>
      {showGps && (
        <div className="meta-form-row">
          <label>
            Latitude — put it anywhere on Earth
            <input inputMode="decimal" placeholder="e.g. 48.8584" value={draft.gpsLat ?? ''} onChange={(e) => onChange({ gpsLat: num(e.target.value) })} />
          </label>
          <label>
            Longitude
            <input inputMode="decimal" placeholder="e.g. 2.2945" value={draft.gpsLon ?? ''} onChange={(e) => onChange({ gpsLon: num(e.target.value) })} />
          </label>
        </div>
      )}
      <label>
        Secret message — invisible in the picture; only someone who checks the metadata sees it
        <textarea
          rows={2}
          maxLength={32000}
          placeholder="e.g. meet at the treehouse at 4"
          value={draft.message ?? ''}
          onChange={(e) => onChange({ message: e.target.value })}
        />
      </label>
    </div>
  );
}

function gpsValid(v: MetaValues): boolean {
  const { gpsLat: lat, gpsLon: lon } = v;
  if (lat == null && lon == null) return true;
  return lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function InspectTab() {
  useEditor();
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [result, setResult] = useState<ReadResult | null>(null);
  const [draft, setDraft] = useState<MetaValues>({});
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void uploadsAll().then((all) => {
      if (alive) setUploads(all.filter((u) => u.kind === 'image').sort((a, b) => b.addedAt - a.addedAt));
    });
    return () => { alive = false; };
  }, [editor.uploadsVersion]);

  const inspect = async (src: Source) => {
    setSource(src);
    setEditing(false);
    setResult(null);
    const r = await readMeta(src.blob);
    setResult(r);
    setDraft(r.editable);
  };

  const outputBlob = async (mode: 'edit' | 'strip'): Promise<Blob | null> => {
    if (!source || !result) return null;
    if (result.format === 'jpeg') {
      return mode === 'strip' ? stripJpegMeta(source.blob) : applyJpegMeta(source.blob, draft);
    }
    if (result.format === 'png') {
      return mode === 'strip' ? stripPngMeta(source.blob) : applyPngMeta(source.blob, draft);
    }
    return null;
  };

  const download = async (mode: 'edit' | 'strip') => {
    if (mode === 'edit' && !gpsValid(draft)) {
      toast('Latitude must be −90…90 and longitude −180…180 (or both empty).', 'error');
      return;
    }
    setBusy(true);
    const blob = await outputBlob(mode);
    setBusy(false);
    if (!blob || !source) return;
    const base = source.name.replace(/\.(jpe?g|png)$/i, '');
    const ext = result?.format === 'png' ? 'png' : 'jpg';
    saveBlob(blob, `${base}${mode === 'strip' ? '-clean' : '-meta'}.${ext}`);
    toast(mode === 'strip'
      ? 'Downloaded a clean copy — same pixels, zero metadata.'
      : 'Downloaded a copy with your edited metadata.');
  };

  const updateUpload = async (mode: 'edit' | 'strip') => {
    if (!source?.uploadId) return;
    if (mode === 'edit' && !gpsValid(draft)) {
      toast('Latitude must be −90…90 and longitude −180…180 (or both empty).', 'error');
      return;
    }
    setBusy(true);
    const blob = await outputBlob(mode);
    if (blob) {
      const rec = await uploadGet(source.uploadId);
      if (rec) {
        rec.blob = blob;
        await uploadPut(rec);
        editor.uploadsVersion++;
        editor.notify();
      }
      await inspect({ ...source, blob });
      toast(mode === 'strip' ? 'Metadata cleared from this upload.' : 'Upload updated with your metadata.');
    }
    setBusy(false);
  };

  const supported = result && (result.format === 'jpeg' || result.format === 'png');

  return (
    <div>
      <div className="dl-label">Pick a photo to look inside</div>
      <div className="meta-thumbs">
        <button className="meta-thumb meta-thumb-file" title="Check any file from your device (it won't be saved)" onClick={() => fileRef.current?.click()}>
          <Icon name="folder" size={20} />
        </button>
        {uploads.map((u) => (
          <button
            key={u.id}
            className={`meta-thumb${source?.uploadId === u.id ? ' active' : ''}`}
            title={u.name}
            onClick={() => void inspect({ name: u.name, blob: u.blob, uploadId: u.id })}
          >
            {u.thumb ? <img src={u.thumb} alt={u.name} /> : <Icon name="image" size={20} />}
          </button>
        ))}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void inspect({ name: f.name, blob: f });
          e.target.value = '';
        }}
      />
      {!source && (
        <div className="hint">
          Photos from a phone secretly carry the camera model, the exact time and
          often the GPS spot where they were taken. Pick one above to see (and
          control) everything hiding inside it. Files you pick from your device
          are read right here in your browser — nothing is uploaded anywhere.
        </div>
      )}
      {source && !result && <div className="hint">Reading “{source.name}”…</div>}
      {source && result && !supported && (
        <div className="hint">
          <b>“{source.name}”</b> isn't a JPG or PNG — metadata viewing works for
          those two. (Tip: most phone photos are JPGs.)
        </div>
      )}
      {source && result && supported && (
        <>
          <div className="meta-file-name">{source.name}</div>
          {!editing && <FieldTable result={result} />}
          {editing && <MetaForm draft={draft} onChange={(p) => setDraft((d) => ({ ...d, ...p }))} showGps={result.format === 'jpeg'} />}
          <div className="meta-actions">
            {!editing && (
              <button className="btn-secondary" onClick={() => setEditing(true)}>
                Edit fields
              </button>
            )}
            {editing && (
              <>
                <button className="btn-primary" disabled={busy} onClick={() => void download('edit')}>
                  Download copy
                </button>
                {source.uploadId && (
                  <button className="btn-secondary" disabled={busy} onClick={() => void updateUpload('edit')}>
                    Save to my uploads
                  </button>
                )}
                <button className="btn-secondary" onClick={() => { setEditing(false); setDraft(result.editable); }}>
                  Cancel
                </button>
              </>
            )}
            {!editing && result.fields.length > 0 && (
              <>
                <button className="btn-primary" disabled={busy} onClick={() => void download('strip')}>
                  <Icon name="shield" size={15} /> Clear all &amp; download
                </button>
                {source.uploadId && (
                  <button className="btn-secondary" disabled={busy} onClick={() => void updateUpload('strip')}>
                    Clear in my uploads
                  </button>
                )}
              </>
            )}
          </div>
          {!editing && (
            <div className="hint">
              <b>Normal:</b> software, copyright, exposure settings — every photo has
              these. <b>Trackable:</b> GPS location, dates, serial numbers and the
              exact phone model can tie a photo to you. “Clear all” removes
              everything without touching a single pixel.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- downloads tab

function DownloadsTab() {
  const saved = getExportMeta();
  const [enabled, setEnabled] = useState(saved.enabled);
  const [draft, setDraft] = useState<MetaValues>(saved.values);

  const save = () => {
    if (enabled && !gpsValid(draft)) {
      toast('Latitude must be −90…90 and longitude −180…180 (or both empty).', 'error');
      return;
    }
    setExportMeta({ enabled, values: draft });
    editor.notify();
    toast(enabled && hasAnyMetaValue(draft)
      ? 'Saved — your next JPG & PNG downloads will carry these fields.'
      : 'Saved — downloads stay completely clean.');
  };

  return (
    <div>
      <button className={`modal-option${!enabled ? ' selected' : ''}`} onClick={() => setEnabled(false)}>
        <Icon name="shield" size={22} />
        <span>
          <b>None — clean file (recommended)</b>
          <small>
            What happens already: OpenCanvas downloads carry zero metadata. No
            location, no device, no dates — nothing to track.
          </small>
        </span>
      </button>
      <button className={`modal-option${enabled ? ' selected' : ''}`} onClick={() => setEnabled(true)}>
        <Icon name="draw" size={22} />
        <span>
          <b>Add my own metadata</b>
          <small>
            Write your own fields into every JPG and PNG you download — claim it
            was taken on any phone, anywhere on Earth, and hide a secret message
            inside.
          </small>
        </span>
      </button>
      {enabled && (
        <>
          <MetaForm draft={draft} onChange={(p) => setDraft((d) => ({ ...d, ...p }))} showGps />
          <div className="hint">
            Applies to JPG and PNG downloads (each page in a multi-page zip gets
            it). To read a hidden message, your friend opens this same window and
            picks the file under <b>Inspect a photo</b>.
          </div>
        </>
      )}
      <button className="btn-primary full" onClick={save}>Save</button>
    </div>
  );
}

// ---------------------------------------------------------------- modal shell

export function MetadataModal() {
  useEditor();
  const [tab, setTab] = useState<'inspect' | 'downloads'>('inspect');
  if (!editor.metadataModalOpen) return null;
  const close = () => {
    editor.metadataModalOpen = false;
    editor.notify();
  };
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Image metadata</div>
        <p className="modal-sub">
          Photos carry hidden info — camera model, date, sometimes the exact GPS
          spot. OpenCanvas downloads are <b>clean by default</b>. Here you can peek
          inside any photo, scrub it, or write your own fields — even a hidden
          message only metadata-checkers will find.
        </p>
        <div className="meta-tabs">
          <button className={`chip${tab === 'inspect' ? ' active' : ''}`} onClick={() => setTab('inspect')}>
            Inspect a photo
          </button>
          <button className={`chip${tab === 'downloads' ? ' active' : ''}`} onClick={() => setTab('downloads')}>
            Your downloads
          </button>
        </div>
        <div className="meta-body">
          {tab === 'inspect' ? <InspectTab /> : <DownloadsTab />}
        </div>
        <button className="btn-secondary full" onClick={close}>Close</button>
      </div>
    </div>
  );
}
