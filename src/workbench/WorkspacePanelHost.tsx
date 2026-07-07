import type { ReactNode } from 'react';
import type { WorkbenchPanelContribution } from '../core/types';

export type WorkspacePanelDefinition<TPanelId extends string = string> = {
  id: TPanelId;
  label: string;
  panel?: WorkbenchPanelContribution;
};

export function WorkspacePanelHost<TPanelId extends string>({
  panels,
  activePanelId,
  className = '',
  closeTitle,
  onActivePanelChange,
  onClose,
  renderPanel,
}: {
  panels: WorkspacePanelDefinition<TPanelId>[];
  activePanelId: TPanelId;
  className?: string;
  closeTitle: string;
  onActivePanelChange: (panelId: TPanelId) => void;
  onClose: () => void;
  renderPanel: (panelId: TPanelId) => ReactNode;
}) {
  return (
    <aside className={`workspace-panel-host ${className}`.trim()}>
      <div className="workspace-panel-header">
        <div className="segmented compact workspace-panel-tabs">
          {panels.map((panel) => (
            <button key={panel.id} className={activePanelId === panel.id ? 'active' : ''} type="button" onClick={() => onActivePanelChange(panel.id)}>
              {panel.label}
            </button>
          ))}
        </div>
        <button type="button" className="workspace-panel-close" onClick={onClose} title={closeTitle}>
          ×
        </button>
      </div>
      <div className="workspace-panel-content">{renderPanel(activePanelId)}</div>
    </aside>
  );
}
