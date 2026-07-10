import { useRef, useState } from 'react';
import { editor } from '../../editor/Editor';
import { addGoogleFont, addUserFontFile, customFonts, removeCustomFont } from '../../editor/fonts';
import { toast } from '../../editor/toast';
import { useEditor } from '../../editor/useEditor';
import { Icon } from './../icons';

export function TextPanel() {
  useEditor();
  const [gname, setGname] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const custom = customFonts();

  const addByName = async () => {
    const name = gname.trim();
    if (!name || busy) return;
    setBusy(true);
    const fam = await addGoogleFont(name);
    setBusy(false);
    if (fam) {
      setGname('');
      toast(`Added “${fam}” — pick it in the font menu when editing text.`);
    } else {
      toast(`Couldn't find “${name}” on Google Fonts — check the exact name on fonts.google.com.`, 'error');
    }
    editor.notify();
  };

  const uploadFonts = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      const name = await addUserFontFile(f);
      if (name) toast(`Font “${name}” added.`);
      else toast(`Couldn't read “${f.name}” as a font file.`, 'error');
    }
    editor.notify();
  };

  return (
    <div className="panel-scroll">
      <div className="panel-heading">Click to add text</div>
      <button className="text-preset heading" onClick={() => void editor.addText('heading')}>
        Add a heading
      </button>
      <button className="text-preset subheading" onClick={() => void editor.addText('subheading')}>
        Add a subheading
      </button>
      <button className="text-preset body" onClick={() => void editor.addText('body')}>
        Add a little bit of body text
      </button>
      <div className="hint">
        Double-click any text on the canvas to edit it. Use the toolbar for font,
        size, color, spacing, effects and more.
      </div>

      <div className="panel-heading">Add fonts</div>
      <div className="hint" style={{ marginTop: 0 }}>
        Type any font name from{' '}
        <a href="https://fonts.google.com" target="_blank" rel="noreferrer">fonts.google.com</a>{' '}
        (e.g. “Roboto Slab”) — or upload your own font file.
      </div>
      <div className="size-form" style={{ marginTop: 8 }}>
        <input
          placeholder="Google Font name"
          value={gname}
          onChange={(e) => setGname(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void addByName()}
          aria-label="Google Font name"
        />
        <button className="btn-secondary" disabled={busy || !gname.trim()} onClick={() => void addByName()}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".ttf,.otf,.woff,.woff2"
        style={{ display: 'none' }}
        onChange={(e) => {
          void uploadFonts(e.target.files);
          e.target.value = '';
        }}
      />
      <button className="btn-secondary full" onClick={() => fileRef.current?.click()}>
        <Icon name="uploads" size={16} /> Upload font file (.ttf, .otf, .woff)
      </button>
      {custom.length > 0 && (
        <>
          <div className="panel-heading">Your fonts</div>
          <div className="font-manage-list">
            {custom.map((f) => (
              <div key={f} className="font-manage-item">
                <span style={{ fontFamily: `'${f}'` }}>{f}</span>
                <button
                  className="icon-btn small"
                  title="Remove this font from your list"
                  onClick={() => {
                    void removeCustomFont(f).then(() => editor.notify());
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="hint">
            Custom fonts are saved in your browser and travel inside saved project files.
          </div>
        </>
      )}
    </div>
  );
}
