import { useEffect, useRef, useState } from 'react';
import { editor } from '../../editor/Editor';
import { useEditor } from '../../editor/useEditor';
import { uploadsAll, uploadDelete, uploadTouch, type UploadRecord } from '../../editor/db';
import { importFiles, insertUpload } from '../../editor/importers';
import { RETENTION_DAYS } from '../../constants';
import { Icon } from './../icons';

const KIND_LABEL: Record<UploadRecord['kind'], string> = {
  image: 'Image', svg: 'SVG', pdf: 'PDF', pptx: 'PowerPoint', html: 'HTML',
};

export function UploadsPanel() {
  useEditor();
  const [items, setItems] = useState<UploadRecord[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void uploadsAll().then((all) => {
      if (alive) setItems(all.sort((a, b) => b.addedAt - a.addedAt));
    });
    return () => { alive = false; };
  }, [editor.uploadsVersion]);

  return (
    <div className="panel-scroll">
      <input
        ref={fileRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) void importFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <button className="btn-primary full" onClick={() => fileRef.current?.click()}>
        <Icon name="uploads" size={18} /> Upload files
      </button>
      <div className="hint">
        Images, SVG, PDF, PPTX, HTML — and saved <b>.opencanvas</b> project files, which open
        right back up for editing. You can also drag &amp; drop files anywhere, or paste an image.
        Uploads stay in your browser and are removed after {RETENTION_DAYS} days of not being used.
      </div>
      {items.length > 0 && <div className="panel-heading">Your uploads</div>}
      <div className="uploads-grid">
        {items.map((u) => (
          <div key={u.id} className="upload-card">
            <button
              className="upload-thumb"
              title={`Add "${u.name}" to the canvas`}
              onClick={() => {
                void uploadTouch(u.id);
                void insertUpload(u);
              }}
            >
              {u.thumb ? (
                <img src={u.thumb} alt={u.name} />
              ) : (
                <span className="upload-filetype">
                  <Icon name="file" size={26} />
                  {KIND_LABEL[u.kind]}
                </span>
              )}
            </button>
            <div className="upload-meta">
              <span className="upload-name" title={u.name}>{u.name}</span>
              <button
                className="icon-btn small"
                title="Remove from uploads"
                onClick={() => {
                  void uploadDelete(u.id).then(() => {
                    editor.uploadsVersion++;
                    editor.notify();
                  });
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {items.length === 0 && (
        <div className="uploads-empty">
          <Icon name="image" size={40} />
          <p>Nothing here yet.<br />Upload images, PDFs, SVGs, PPTX or HTML files to reuse them any time.</p>
        </div>
      )}
    </div>
  );
}
