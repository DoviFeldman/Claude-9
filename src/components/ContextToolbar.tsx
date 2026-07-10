import { useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import { anyToHex } from '../editor/colors';
import { editor, ensureFont, isTextObject } from '../editor/Editor';
import { addGoogleFont, allFonts } from '../editor/fonts';
import { fillToCss } from '../editor/gradients';
import { toast } from '../editor/toast';
import { useEditor } from '../editor/useEditor';
import { ColorPicker } from './ColorPicker';
import { FillPicker } from './FillPicker';
import { Icon } from './icons';
import { Popover } from './Popover';

type SelKind = 'none' | 'text' | 'image' | 'line' | 'drawing' | 'shape' | 'group' | 'multi';

function selectionKind(obj: fabric.FabricObject | undefined, count: number): SelKind {
  if (!obj) return 'none';
  if (count > 1) return 'multi';
  if (isTextObject(obj)) return 'text';
  if (obj instanceof fabric.FabricImage) return 'image';
  const kind = (obj as any).shapeKind;
  if (kind === 'line' || obj instanceof fabric.Line) return 'line';
  if (obj instanceof fabric.Path && !kind) return 'drawing';
  if (obj instanceof fabric.Group) return 'group';
  return 'shape';
}

function Chip({ color, title }: { color: string; title: string }) {
  return <span className="color-chip" title={title} style={{ background: color }} />;
}

function FontSelect({ obj }: { obj: fabric.FabricObject }) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const current = ((obj as any).fontFamily as string) ?? 'Inter';
  const q = query.trim();
  const fonts = allFonts().filter((f) => f.toLowerCase().includes(q.toLowerCase()));
  const exactMatch = fonts.some((f) => f.toLowerCase() === q.toLowerCase());
  return (
    <Popover
      panelClassName="font-panel"
      button={
        <button className="tb-btn font-btn" title="Font">
          <span style={{ fontFamily: `'${current}'` }}>{current}</span>
          <Icon name="chevronDown" size={13} />
        </button>
      }
    >
      {(close) => (
        <div>
          <div className="font-search">
            <Icon name="search" size={15} />
            <input
              autoFocus
              placeholder="Search fonts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="font-list">
            {fonts.map((f) => (
              <button
                key={f}
                className={`font-item${f === current ? ' active' : ''}`}
                style={{ fontFamily: `'${f}'` }}
                onClick={async () => {
                  await ensureFont(f);
                  editor.setProps({ fontFamily: f });
                  close();
                }}
              >
                {f}
                {f === current && <Icon name="check" size={15} />}
              </button>
            ))}
          </div>
          {q && !exactMatch && (
            <button
              className="font-add"
              disabled={adding}
              title="Fetch this font from Google Fonts and apply it"
              onClick={async () => {
                setAdding(true);
                const fam = await addGoogleFont(q);
                setAdding(false);
                if (fam) {
                  await ensureFont(fam);
                  editor.setProps({ fontFamily: fam });
                  editor.notify();
                  close();
                } else {
                  toast(`Couldn't find “${q}” on Google Fonts — check the name on fonts.google.com.`, 'error');
                }
              }}
            >
              <Icon name="plus" size={15} />
              {adding ? 'Adding…' : `Add “${q}” from Google Fonts`}
            </button>
          )}
        </div>
      )}
    </Popover>
  );
}

function FontSizeControl({ obj }: { obj: fabric.FabricObject }) {
  const size = Math.round(((obj as any).fontSize ?? 16) * (obj.scaleY ?? 1));
  const apply = (next: number) => {
    const clamped = Math.max(4, Math.min(500, next));
    editor.setProps({ fontSize: clamped / (obj.scaleY || 1) });
  };
  return (
    <div className="font-size">
      <button className="icon-btn small" onClick={() => apply(size - 2)} title="Decrease font size"><Icon name="minus" size={14} /></button>
      <input
        value={size}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (!Number.isNaN(v)) apply(v);
        }}
        inputMode="numeric"
        aria-label="Font size"
      />
      <button className="icon-btn small" onClick={() => apply(size + 2)} title="Increase font size"><Icon name="plus" size={14} /></button>
    </div>
  );
}

function TextControls({ obj }: { obj: fabric.FabricObject }) {
  const o = obj as any;
  const shadow = obj.shadow as fabric.Shadow | null;
  const alignments = ['left', 'center', 'right'] as const;
  const currentAlign = (o.textAlign ?? 'left') as string;

  return (
    <>
      <FontSelect obj={obj} />
      <FontSizeControl obj={obj} />
      <Popover title="Text color & gradient" button={<button className="tb-btn"><Chip color={fillToCss(o.fill)} title="Text color" /></button>}>
        <FillPicker
          fill={o.fill}
          onSolid={(hex, final) => editor.setColor(hex, final)}
          onGradient={(spec, final) => editor.setGradient(spec, final)}
        />
      </Popover>
      <button
        className={`tb-btn glyph${o.fontWeight === 700 || o.fontWeight === 'bold' ? ' on' : ''}`}
        title="Bold"
        onClick={() => editor.setProps({ fontWeight: o.fontWeight === 700 || o.fontWeight === 'bold' ? 400 : 700 })}
      ><b>B</b></button>
      <button
        className={`tb-btn glyph${o.fontStyle === 'italic' ? ' on' : ''}`}
        title="Italic"
        onClick={() => editor.setProps({ fontStyle: o.fontStyle === 'italic' ? 'normal' : 'italic' })}
      ><i>I</i></button>
      <button
        className={`tb-btn glyph${o.underline ? ' on' : ''}`}
        title="Underline"
        onClick={() => editor.setProps({ underline: !o.underline })}
      ><u>U</u></button>
      <button
        className={`tb-btn glyph${o.linethrough ? ' on' : ''}`}
        title="Strikethrough"
        onClick={() => editor.setProps({ linethrough: !o.linethrough })}
      ><s>S</s></button>
      <button
        className="tb-btn glyph"
        title={`Align: ${currentAlign} (click to change)`}
        onClick={() => {
          const next = alignments[(alignments.indexOf(currentAlign as any) + 1) % alignments.length];
          editor.setProps({ textAlign: next });
        }}
      >
        <Icon name={currentAlign === 'center' ? 'alignCenter' : currentAlign === 'right' ? 'alignRight' : 'alignLeft'} size={18} />
      </button>
      <Popover title="Letter & line spacing" button={<button className="tb-btn"><Icon name="spacing" size={18} /></button>}>
        <div className="slider-panel">
          <div className="slider-row">
            <span>Letter spacing</span>
            <span>{Math.round((o.charSpacing ?? 0) / 10) / 10}</span>
          </div>
          <input
            className="slider" type="range" min={-200} max={1000} step={10}
            value={o.charSpacing ?? 0}
            onChange={(e) => editor.setProps({ charSpacing: +e.target.value }, false)}
            onPointerUp={() => editor.commitActive()}
          />
          <div className="slider-row">
            <span>Line spacing</span>
            <span>{(o.lineHeight ?? 1.16).toFixed(2)}</span>
          </div>
          <input
            className="slider" type="range" min={0.5} max={3} step={0.05}
            value={o.lineHeight ?? 1.16}
            onChange={(e) => editor.setProps({ lineHeight: +e.target.value }, false)}
            onPointerUp={() => editor.commitActive()}
          />
        </div>
      </Popover>
      <Popover title="Effects (shadow & background)" button={<button className="tb-btn"><Icon name="effects" size={18} /><span>Effects</span></button>}>
        <div className="slider-panel">
          <div className="slider-row"><b>Shadow</b>
            <input
              type="checkbox"
              checked={!!shadow}
              onChange={(e) => {
                editor.setProps({
                  shadow: e.target.checked
                    ? new fabric.Shadow({ color: 'rgba(0,0,0,0.45)', blur: 8, offsetX: 4, offsetY: 4 })
                    : null,
                });
              }}
            />
          </div>
          {shadow && (
            <>
              <div className="slider-row"><span>Blur</span><span>{shadow.blur}</span></div>
              <input className="slider" type="range" min={0} max={60} value={shadow.blur}
                onChange={(e) => { shadow.blur = +e.target.value; editor.setProps({ shadow }, false); }}
                onPointerUp={() => editor.commitActive()} />
              <div className="slider-row"><span>Offset X</span><span>{shadow.offsetX}</span></div>
              <input className="slider" type="range" min={-40} max={40} value={shadow.offsetX}
                onChange={(e) => { shadow.offsetX = +e.target.value; editor.setProps({ shadow }, false); }}
                onPointerUp={() => editor.commitActive()} />
              <div className="slider-row"><span>Offset Y</span><span>{shadow.offsetY}</span></div>
              <input className="slider" type="range" min={-40} max={40} value={shadow.offsetY}
                onChange={(e) => { shadow.offsetY = +e.target.value; editor.setProps({ shadow }, false); }}
                onPointerUp={() => editor.commitActive()} />
              <div className="slider-row"><span>Shadow color</span></div>
              <ColorPicker
                value={anyToHex(shadow.color) ?? '#000000'}
                onChange={(hex, final) => {
                  shadow.color = hex;
                  editor.setProps({ shadow }, final);
                }}
              />
            </>
          )}
          <div className="slider-row" style={{ marginTop: 10 }}><b>Text background</b>
            <input
              type="checkbox"
              checked={!!o.backgroundColor}
              onChange={(e) => editor.setProps({ backgroundColor: e.target.checked ? '#ffe66d' : '' })}
            />
          </div>
          {o.backgroundColor && (
            <ColorPicker
              value={anyToHex(o.backgroundColor) ?? '#ffe66d'}
              onChange={(hex, final) => editor.setProps({ backgroundColor: hex }, final)}
            />
          )}
        </div>
      </Popover>
    </>
  );
}

function ShapeControls({ obj, kind }: { obj: fabric.FabricObject; kind: SelKind }) {
  const o = obj as any;
  const isLineLike = kind === 'line' || kind === 'drawing';
  const fillValue = isLineLike ? o.stroke : o.fill;
  const color = fillValue ? fillToCss(fillValue) : (isLineLike ? '#1a1a1a' : '#8b3dff');
  const canRound = kind === 'shape' && (obj instanceof fabric.Rect || o.shapeKind === 'triangle');
  const maxRadius = Math.round(Math.min(obj.width ?? 100, obj.height ?? 100) / 2);
  const radius = Math.round(o.shapeKind === 'triangle' ? (o.cornerRadius ?? 0) : (o.rx ?? 0));

  return (
    <>
      <Popover title="Color & gradient" button={<button className="tb-btn"><Chip color={color} title="Color" /></button>}>
        <FillPicker
          fill={fillValue}
          onSolid={(hex, final) => editor.setColor(hex, final)}
          onGradient={(spec, final) => editor.setGradient(spec, final)}
        />
      </Popover>
      {isLineLike && (
        <Popover title="Line thickness" button={<button className="tb-btn"><Icon name="minus" size={18} /><span>{Math.round(o.strokeWidth ?? 1)}px</span></button>}>
          <div className="slider-panel">
            <div className="slider-row"><span>Thickness</span><span>{Math.round(o.strokeWidth ?? 1)}px</span></div>
            <input
              className="slider" type="range" min={1} max={60} value={o.strokeWidth ?? 1}
              onChange={(e) => editor.setProps({ strokeWidth: +e.target.value }, false)}
              onPointerUp={() => editor.commitActive()}
            />
          </div>
        </Popover>
      )}
      {!isLineLike && (
        <Popover title="Border" button={<button className="tb-btn"><Icon name="border" size={18} /><span>Border</span></button>}>
          <div className="slider-panel">
            <div className="slider-row"><b>Border</b>
              <input
                type="checkbox"
                checked={!!o.stroke && (o.strokeWidth ?? 0) > 0}
                onChange={(e) =>
                  editor.setProps(e.target.checked
                    ? { stroke: '#1a1a1a', strokeWidth: Math.max(2, o.strokeWidth || 0) }
                    : { stroke: null, strokeWidth: 0 })
                }
              />
            </div>
            {!!o.stroke && (o.strokeWidth ?? 0) > 0 && (
              <>
                <div className="slider-row"><span>Width</span><span>{Math.round(o.strokeWidth)}px</span></div>
                <input className="slider" type="range" min={1} max={40} value={o.strokeWidth}
                  onChange={(e) => editor.setProps({ strokeWidth: +e.target.value }, false)}
                  onPointerUp={() => editor.commitActive()} />
                <div className="dl-scopes" style={{ margin: '8px 0' }}>
                  <button className={`chip${!o.strokeDashArray ? ' active' : ''}`} onClick={() => editor.setProps({ strokeDashArray: null })}>Solid</button>
                  <button className={`chip${o.strokeDashArray ? ' active' : ''}`} onClick={() => editor.setProps({ strokeDashArray: [o.strokeWidth * 2.5, o.strokeWidth * 2] })}>Dashed</button>
                </div>
                <ColorPicker
                  value={anyToHex(o.stroke) ?? '#1a1a1a'}
                  onChange={(hex, final) => editor.setProps({ stroke: hex }, final)}
                />
              </>
            )}
          </div>
        </Popover>
      )}
      {canRound && (
        <Popover title="Corner rounding" button={<button className="tb-btn"><Icon name="rounding" size={18} /></button>}>
          <div className="slider-panel">
            <div className="slider-row"><span>Corner rounding</span><span>{radius}</span></div>
            <input
              className="slider" type="range" min={0} max={maxRadius} value={radius}
              onChange={(e) => editor.setCornerRadius(+e.target.value, false)}
              onPointerUp={() => editor.commitActive()}
            />
          </div>
        </Popover>
      )}
    </>
  );
}

function ReplaceColorPanel() {
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState('#8b3dff');
  const [tol, setTol] = useState(60);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  useEditor();

  // while picking, intercept the next canvas click before fabric/popover see it
  useEffect(() => {
    if (!picking) return;
    document.body.classList.add('eyedropping');
    const onDown = (e: PointerEvent) => {
      const hex = editor.samplePixelFromEvent(e);
      if (hex) {
        e.preventDefault();
        e.stopPropagation();
        setFrom(hex);
      }
      setPicking(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setPicking(false); }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.body.classList.remove('eyedropping');
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [picking]);

  return (
    <div className="slider-panel replace-color">
      <div className="hint" style={{ marginTop: 0 }}>
        Pick a color from the image, choose a new color, then apply. This edits the
        image pixels permanently (undo works).
      </div>
      <button
        className={`btn-secondary full${picking ? ' waiting' : ''}`}
        onClick={() => setPicking(true)}
      >
        <Icon name="eyedropper" size={16} />
        {picking ? 'Click the image…' : from ? 'Pick again' : 'Pick color from image'}
      </button>
      {from && (
        <>
          <div className="replace-row">
            <span className="color-chip big" style={{ background: from }} />
            <span>→</span>
            <span className="color-chip big" style={{ background: to }} />
          </div>
          <div className="slider-row"><span>Tolerance</span><span>{tol}</span></div>
          <input className="slider" type="range" min={5} max={160} value={tol} onChange={(e) => setTol(+e.target.value)} />
          <ColorPicker value={to} onChange={(hex) => setTo(hex)} />
          <button
            className="btn-primary full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await editor.replaceColorInImage(from, to, tol);
              setBusy(false);
            }}
          >
            {busy ? 'Working…' : 'Replace color'}
          </button>
        </>
      )}
    </div>
  );
}

function ImageControls() {
  return (
    <>
      <button className="tb-btn" onClick={() => editor.beginCrop()} title="Crop the image (permanent)">
        <Icon name="crop" size={18} /><span>Crop</span>
      </button>
      <Popover title="Replace a color in the image" button={<button className="tb-btn"><Icon name="palette" size={18} /><span>Replace color</span></button>}>
        <ReplaceColorPanel />
      </Popover>
      <a
        className="tb-btn"
        href="https://www.remove.bg/upload"
        target="_blank"
        rel="noreferrer"
        title="Opens remove.bg — remove the background there, download the result and re-upload it here"
      >
        <Icon name="magic" size={18} /><span>Remove BG</span>
      </a>
    </>
  );
}

function CommonControls({ obj, kind }: { obj: fabric.FabricObject; kind: SelKind }) {
  const locked = !!(obj as any).locked;
  return (
    <>
      {(kind === 'multi') && (
        <button className="tb-btn" onClick={() => editor.groupSelection()} title="Group (Ctrl+G)">
          <Icon name="group" size={18} /><span>Group</span>
        </button>
      )}
      {kind === 'group' && (
        <button className="tb-btn" onClick={() => editor.ungroupSelection()} title="Ungroup">
          <Icon name="group" size={18} /><span>Ungroup</span>
        </button>
      )}
      {(kind === 'image' || kind === 'shape' || kind === 'group' || kind === 'multi') && (
        <>
          <button className="icon-btn" onClick={() => editor.flipSelected('x')} title="Flip horizontal"><Icon name="flipH" size={18} /></button>
          <button className="icon-btn" onClick={() => editor.flipSelected('y')} title="Flip vertical"><Icon name="flipV" size={18} /></button>
        </>
      )}
      <div className="tb-sep" />
      <Popover align="right" title="Position & layering" button={<button className="tb-btn"><Icon name="layers" size={18} /><span>Position</span></button>}>
        <div className="position-panel">
          <div className="cp-label">Layer</div>
          <div className="pos-grid">
            <button className="btn-secondary" onClick={() => editor.layer('forward')}>Forward</button>
            <button className="btn-secondary" onClick={() => editor.layer('backward')}>Backward</button>
            <button className="btn-secondary" onClick={() => editor.layer('front')}>To front</button>
            <button className="btn-secondary" onClick={() => editor.layer('back')}>To back</button>
          </div>
          <div className="cp-label">Align to page</div>
          <div className="pos-grid three">
            <button className="btn-secondary" onClick={() => editor.alignToPage('left')}>Left</button>
            <button className="btn-secondary" onClick={() => editor.alignToPage('centerH')}>Center</button>
            <button className="btn-secondary" onClick={() => editor.alignToPage('right')}>Right</button>
            <button className="btn-secondary" onClick={() => editor.alignToPage('top')}>Top</button>
            <button className="btn-secondary" onClick={() => editor.alignToPage('centerV')}>Middle</button>
            <button className="btn-secondary" onClick={() => editor.alignToPage('bottom')}>Bottom</button>
          </div>
        </div>
      </Popover>
      <Popover align="right" title="Transparency" button={<button className="icon-btn"><Icon name="transparency" size={18} /></button>}>
        <div className="slider-panel">
          <div className="slider-row"><span>Transparency</span><span>{Math.round((obj.opacity ?? 1) * 100)}%</span></div>
          <input
            className="slider" type="range" min={5} max={100}
            value={Math.round((obj.opacity ?? 1) * 100)}
            onChange={(e) => editor.setProps({ opacity: +e.target.value / 100 }, false)}
            onPointerUp={() => editor.commitActive()}
          />
        </div>
      </Popover>
      <button className={`icon-btn${locked ? ' on' : ''}`} onClick={() => editor.toggleLock()} title={locked ? 'Unlock' : 'Lock'}>
        <Icon name={locked ? 'lock' : 'unlock'} size={18} />
      </button>
      <button className="icon-btn" onClick={() => void editor.duplicateSelected()} title="Duplicate (Ctrl+D)">
        <Icon name="duplicate" size={18} />
      </button>
      <button className="icon-btn" onClick={() => editor.deleteSelected()} title="Delete (Del)">
        <Icon name="trash" size={18} />
      </button>
    </>
  );
}

export function ContextToolbar() {
  useEditor();
  const obj = editor.getActiveObject();
  const objs = editor.getActiveObjects();
  const kind = selectionKind(obj, objs.length);
  const canvas = editor.activeCanvas;
  const pageBg = fillToCss(canvas?.backgroundColor);

  // Purely visual: when the toolbar's contents switch (selection kind
  // changes), briefly keep showing the old controls while the pill
  // collapses into a dark flash, then reopen with the new controls.
  const [anim, setAnim] = useState<'idle' | 'closing' | 'opening'>('idle');
  const [frozen, setFrozen] = useState<{ kind: SelKind; obj?: fabric.FabricObject } | null>(null);
  const prevKind = useRef(kind);
  const live = useRef<{ kind: SelKind; obj?: fabric.FabricObject }>({ kind, obj });
  useEffect(() => {
    if (kind === prevKind.current) return;
    prevKind.current = kind;
    setFrozen(live.current);
    setAnim('closing');
    const t1 = setTimeout(() => { setFrozen(null); setAnim('opening'); }, 130);
    const t2 = setTimeout(() => setAnim('idle'), 330);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [kind]);
  useEffect(() => { live.current = { kind, obj }; });

  const showKind = frozen ? frozen.kind : kind;
  const showObj = frozen ? frozen.obj : obj;

  return (
    <div className={`context-toolbar${anim === 'closing' ? ' ctx-closing' : anim === 'opening' ? ' ctx-opening' : ''}`}>
      {showKind === 'none' && (
        <>
          <Popover title="Page background — color or gradient" button={
            <button className="tb-btn"><Chip color={pageBg} title="Page color" /><span>Page color</span></button>
          }>
            <FillPicker
              fill={canvas?.backgroundColor}
              onSolid={(hex, final) => editor.setPageBackground(hex, final)}
              onGradient={(spec, final) => editor.setPageGradient(spec, final)}
            />
          </Popover>
          <span className="toolbar-hint">
            Select something on a page to edit it — or add shapes, text and uploads from the left panel.
          </span>
        </>
      )}
      {showKind === 'text' && showObj && <TextControls obj={showObj} />}
      {(showKind === 'shape' || showKind === 'line' || showKind === 'drawing') && showObj && <ShapeControls obj={showObj} kind={showKind} />}
      {showKind === 'image' && <ImageControls />}
      {showKind !== 'none' && showObj && (
        <>
          <div className="tb-spacer" />
          <CommonControls obj={showObj} kind={showKind} />
        </>
      )}
    </div>
  );
}
