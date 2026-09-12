import { X } from 'lucide-react';

export interface ReaderSidebarOpenItem {
  id: string;
  title: string;
  hint?: string;
  active?: boolean;
}

export interface ReaderSceneSidebarProps {
  openItems?: ReaderSidebarOpenItem[];
  onSelectItem?: (itemId: string) => void;
  onCloseItem?: (itemId: string) => void;
}

/** Open-document navigator owned by the reader scene plugin. */
export function ReaderSceneSidebar({ openItems = [], onSelectItem, onCloseItem }: ReaderSceneSidebarProps) {
  return (
    <div className="scene-context-sidebar reader-scene-sidebar">
      <div className="scene-context-sidebar-heading">正在阅读</div>
      {openItems.length === 0 ? (
        <p className="workbench-sidebar-hint">暂无打开文档</p>
      ) : (
        <ul className="scene-context-list">
          {openItems.map((item) => (
            <li key={item.id} className={item.active ? 'active' : undefined}>
              <button type="button" className="scene-context-item" onClick={() => onSelectItem?.(item.id)} title={item.hint ?? item.title}>
                <span className="scene-context-item-title">{item.title}</span>
              </button>
              {onCloseItem && <button type="button" className="scene-context-item-close" title="关闭" aria-label={`关闭 ${item.title}`} onClick={() => onCloseItem(item.id)}><X size={13} aria-hidden="true" /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
