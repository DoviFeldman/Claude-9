import { editor } from '../editor/Editor';
import { useEditor } from '../editor/useEditor';
import { Icon } from './icons';

export function BottomBar() {
  useEditor();
  const pct = Math.round(editor.zoom * 100);

  return (
    <div className="bottombar">
      <span className="bb-info">
        {editor.pages.length} page{editor.pages.length > 1 ? 's' : ''} · {editor.docW} × {editor.docH} px
        <span className="bb-tip"> · Ctrl+scroll to zoom, Space+drag to pan</span>
      </span>
      <div className="bb-zoom">
        <button className="icon-btn small" onClick={() => editor.setZoom(editor.zoom / 1.2)} title="Zoom out">
          <Icon name="minus" size={15} />
        </button>
        <input
          className="slider zoom-slider"
          type="range"
          min={5}
          max={400}
          value={pct}
          onChange={(e) => editor.setZoom(+e.target.value / 100)}
          title="Zoom"
        />
        <button className="icon-btn small" onClick={() => editor.setZoom(editor.zoom * 1.2)} title="Zoom in">
          <Icon name="plus" size={15} />
        </button>
        <span className="bb-pct">{pct}%</span>
        <button className="tb-btn" onClick={() => editor.zoomToFit()} title="Fit page to screen">
          <Icon name="fit" size={15} /><span>Fit</span>
        </button>
      </div>
    </div>
  );
}
