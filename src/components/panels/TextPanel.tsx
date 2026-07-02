import { editor } from '../../editor/Editor';

export function TextPanel() {
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
    </div>
  );
}
