import { useState } from 'react';
import { editor } from '../editor/Editor';
import { getExportMeta, hasAnyMetaValue } from '../editor/exifmeta';
import { useEditor } from '../editor/useEditor';
import { exportSize, runExport, type ExportCompression, type ExportFormat, type ExportScope } from '../editor/exporters';
import { Icon } from './icons';
import { Popover } from './Popover';

const FORMATS: { id: ExportFormat; label: string; note: string }[] = [
  { id: 'jpg', label: 'JPG', note: 'Best for sharing' },
  { id: 'png', label: 'PNG', note: 'Crisp, supports transparency' },
  { id: 'pdf', label: 'PDF', note: 'Documents & print' },
  { id: 'svg', label: 'SVG', note: 'Scalable vector' },
  { id: 'html', label: 'HTML', note: 'Web page — text stays selectable' },
  { id: 'dxf', label: 'DXF', note: 'CAD drawing — clean vector outlines' },
];

const COMPRESSION_CHOICES: { id: ExportCompression; label: string }[] = [
  { id: 'original', label: 'Original quality (default)' },
  { id: 'balanced', label: 'Balanced — smaller file' },
  { id: 'compressed', label: 'Compressed — small file' },
  { id: 'max', label: 'Max compression — smallest file' },
];

export function DownloadMenu() {
  useEditor();
  const [format, setFormat] = useState<ExportFormat>(() => (localStorage.getItem('oc-format') as ExportFormat) || 'jpg');
  const [scope, setScope] = useState<ExportScope>('all');
  const [transparent, setTransparent] = useState(false);
  const [compression, setCompression] = useState<ExportCompression>('original');
  const hasSelection = !!editor.getActiveObject();
  const busy = !!editor.busyMessage;

  const pickFormat = (f: ExportFormat) => {
    setFormat(f);
    localStorage.setItem('oc-format', f);
  };

  return (
    <Popover
      align="right"
      panelClassName="download-panel"
      button={(open) => (
        <button className="btn-primary download-btn">
          <Icon name="download" size={18} />
          <span>Download</span>
          <Icon name="chevronDown" size={14} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="panel-title">Download</div>
          <div className="dl-label">File type</div>
          <div className="dl-formats">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                className={`dl-format${format === f.id ? ' active' : ''}`}
                onClick={() => pickFormat(f.id)}
              >
                <span className="dl-format-name">{f.label}</span>
                <span className="dl-format-note">{f.note}</span>
                {format === f.id && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
          <div className="dl-label">Pages</div>
          <div className="dl-scopes">
            <button className={`chip${scope === 'all' ? ' active' : ''}`} onClick={() => setScope('all')}>All pages</button>
            <button className={`chip${scope === 'current' ? ' active' : ''}`} onClick={() => setScope('current')}>Current page</button>
            <button
              className={`chip${scope === 'selection' ? ' active' : ''}`}
              disabled={!hasSelection}
              title={hasSelection ? 'Download only the selected element(s)' : 'Select something on the canvas first'}
              onClick={() => setScope('selection')}
            >
              Selection only
            </button>
          </div>
          {(format === 'jpg' || format === 'pdf') && (
            <>
              <div className="dl-label">Compression</div>
              <select
                className="dl-select"
                value={compression}
                onChange={(e) => setCompression(e.target.value as ExportCompression)}
                aria-label="Compression"
              >
                {COMPRESSION_CHOICES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </>
          )}
          {format === 'png' && (
            <label className="dl-check">
              <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
              Transparent background
            </label>
          )}
          {(format === 'jpg' || format === 'png' || format === 'pdf') && <SizeLine format={format} scope={scope} compression={compression} />}
          <button
            className="btn-primary full"
            disabled={busy}
            onClick={() => {
              void runExport({ format, scope, transparent, compression }).then(close);
            }}
          >
            {busy ? 'Preparing…' : `Download ${format.toUpperCase()}`}
          </button>
          <MetaRow close={close} />
        </div>
      )}
    </Popover>
  );
}

/** One grey line: the real pixel size you'll get (photos keep their pixels, text stays sharp). */
function SizeLine({ format, scope, compression }: { format: 'jpg' | 'png' | 'pdf'; scope: ExportScope; compression: ExportCompression }) {
  const s = exportSize(format, scope, compression);
  return <div className="hint">{s.width} × {s.height} px{s.limited ? ' (size limit)' : ''}</div>;
}

function MetaRow({ close }: { close: () => void }) {
  const s = getExportMeta();
  const on = s.enabled && hasAnyMetaValue(s.values);
  return (
    <button
      className={`dl-meta-link${on ? ' on' : ''}`}
      onClick={() => {
        editor.metadataModalOpen = true;
        editor.notify();
        close();
      }}
    >
      <Icon name="shield" size={15} />
      {on ? 'Metadata: custom fields will be added' : 'Metadata…'}
    </button>
  );
}
