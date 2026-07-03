import { editor, type PanelTab } from '../editor/Editor';
import { useEditor } from '../editor/useEditor';
import { Icon } from './icons';
import { DesignPanel } from './panels/DesignPanel';
import { ElementsPanel } from './panels/ElementsPanel';
import { TextPanel } from './panels/TextPanel';
import { UploadsPanel } from './panels/UploadsPanel';
import { DrawPanel } from './panels/DrawPanel';

const TABS: { id: Exclude<PanelTab, null>; label: string; icon: string }[] = [
  { id: 'design', label: 'Design', icon: 'design' },
  { id: 'elements', label: 'Elements', icon: 'elements' },
  { id: 'text', label: 'Text', icon: 'text' },
  { id: 'uploads', label: 'Uploads', icon: 'uploads' },
  { id: 'draw', label: 'Draw', icon: 'draw' },
];

export function Sidebar() {
  useEditor();
  const tab = editor.panelTab;

  return (
    <div className="sidebar">
      <nav className="rail">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`rail-item${tab === t.id ? ' active' : ''}`}
            onClick={() => editor.setPanelTab(tab === t.id ? null : t.id)}
          >
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      {tab && (
        <div className="panel">
          <button className="panel-close icon-btn" onClick={() => editor.setPanelTab(null)} title="Close panel">
            <Icon name="chevronLeft" size={16} />
          </button>
          {tab === 'design' && <DesignPanel />}
          {tab === 'elements' && <ElementsPanel />}
          {tab === 'text' && <TextPanel />}
          {tab === 'uploads' && <UploadsPanel />}
          {tab === 'draw' && <DrawPanel />}
        </div>
      )}
    </div>
  );
}
