import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** Shell-owned portal targets. Editors keep ownership of their state and handlers. */
const DocumentToolbarContext = createContext<{
  enabled: boolean;
  controlsHost: HTMLDivElement | null;
  saveHost: HTMLDivElement | null;
  setControlsHost: (node: HTMLDivElement | null) => void;
  setSaveHost: (node: HTMLDivElement | null) => void;
} | null>(null);
export const DocumentToolbarActiveContext = createContext(true);
export const useDocumentToolbar = () => useContext(DocumentToolbarContext);
export const useDocumentToolbarActive = () => useContext(DocumentToolbarActiveContext);
export function DocumentToolbarProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [controlsHost, setControlsHost] = useState<HTMLDivElement | null>(null);
  const [saveHost, setSaveHost] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ enabled, controlsHost, saveHost, setControlsHost, setSaveHost }), [enabled, controlsHost, saveHost]);
  return <DocumentToolbarContext.Provider value={value}>{children}</DocumentToolbarContext.Provider>;
}
