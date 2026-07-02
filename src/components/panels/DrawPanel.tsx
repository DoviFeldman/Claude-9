import { editor } from '../../editor/Editor';
import { useEditor } from '../../editor/useEditor';
import { ColorPicker } from '../ColorPicker';

export function DrawPanel() {
  useEditor();
  const { color, size, opacity } = editor.brush;

  return (
    <div className="panel-scroll">
      <div className="panel-heading">Draw</div>
      <div className="hint" style={{ marginTop: 0 }}>
        Drawing mode is on — drag on the canvas to draw. Close this panel (or press Esc)
        to go back to selecting. Drawn strokes become objects you can select, move and delete.
      </div>
      <div className="panel-heading">Pen size — {size}px</div>
      <input
        className="slider"
        type="range" min={1} max={60} step={1} value={size}
        onChange={(e) => editor.setBrush({ size: +e.target.value })}
      />
      <div className="panel-heading">Transparency — {Math.round(opacity * 100)}%</div>
      <input
        className="slider"
        type="range" min={5} max={100} step={1} value={Math.round(opacity * 100)}
        onChange={(e) => editor.setBrush({ opacity: +e.target.value / 100 })}
      />
      <div className="panel-heading">Color</div>
      <ColorPicker value={color} onChange={(hex) => editor.setBrush({ color: hex })} />
    </div>
  );
}
