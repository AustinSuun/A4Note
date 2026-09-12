import { useState, type ReactNode } from 'react';
import type { WorkbenchLabels } from './workbenchLabels';

export interface TabStripItem {
  id: string;
  title: string;
  hint?: string;
  pinned: boolean;
  icon?: ReactNode;
}

export interface TabStripProps {
  labels: WorkbenchLabels;
  items: TabStripItem[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onTogglePin: (tabId: string) => void;
  onMove: (tabId: string, targetIndex: number) => void;
}

/** Single row of tabs; reordering goes through the store, not local state. */
export function TabStrip({ labels, items, activeTabId, onSelect, onClose, onTogglePin, onMove }: TabStripProps) {
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const finishDrag = () => {
    setDraggingTabId(null);
    setDropIndex(null);
  };

  if (items.length === 0) return <div className="workbench-tabstrip empty" />;

  return (
    <div className="workbench-tabstrip" role="tablist">
      {items.map((item, index) => (
        <div
          key={item.id}
          className={[
            'workbench-tab',
            item.id === activeTabId ? 'active' : '',
            item.pinned ? 'pinned' : '',
            draggingTabId === item.id ? 'dragging' : '',
            dropIndex === index && draggingTabId && draggingTabId !== item.id ? 'drop-target' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          draggable
          onDragStart={() => setDraggingTabId(item.id)}
          onDragEnd={finishDrag}
          onDragOver={(event) => {
            if (!draggingTabId) return;
            event.preventDefault();
            setDropIndex(index);
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (draggingTabId && draggingTabId !== item.id) onMove(draggingTabId, index);
            finishDrag();
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={item.id === activeTabId}
            className="workbench-tab-button"
            title={item.hint ?? item.title}
            onClick={() => onSelect(item.id)}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                onClose(item.id);
              }
            }}
            onDoubleClick={() => onTogglePin(item.id)}
          >
            {item.icon && (
              <span className="workbench-tab-icon" aria-hidden="true">
                {item.icon}
              </span>
            )}
            <span className="workbench-tab-title">{item.title}</span>
          </button>
          <button
            type="button"
            className="workbench-tab-pin"
            title={item.pinned ? labels.unpinTab : labels.pinTab}
            onClick={() => onTogglePin(item.id)}
          >
            {item.pinned ? '★' : '☆'}
          </button>
          <button type="button" className="workbench-tab-close" title={labels.closeTab} onClick={() => onClose(item.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
