import type { ReactNode } from 'react';

export interface TabHostItem {
  id: string;
  content: ReactNode;
}

export interface TabHostProps {
  items: TabHostItem[];
  activeTabId: string | null;
  fallback: ReactNode;
}

/**
 * Every open tab stays mounted and is hidden with CSS, so scroll position and
 * PDF render state survive a tab switch.
 */
export function TabHost({ items, activeTabId, fallback }: TabHostProps) {
  if (items.length === 0) return <div className="workbench-tabhost empty">{fallback}</div>;
  return (
    <div className="workbench-tabhost">
      {items.map((item) => (
        <div
          key={item.id}
          className={item.id === activeTabId ? 'workbench-tab-frame active' : 'workbench-tab-frame hidden'}
          aria-hidden={item.id !== activeTabId}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
