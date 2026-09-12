import type { PluginPermission } from './types';

export interface PluginCatalogEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  source: 'builtin' | 'local' | 'market';
  trust: 'builtin' | 'trusted' | 'untrusted' | 'blocked';
  permissions: PluginPermission[];
  enabled: boolean;
  packagePath?: string;
}

export interface PluginCatalogState { entries: PluginCatalogEntry[] }

export function createPluginCatalog(entries: PluginCatalogEntry[] = []): PluginCatalogState {
  return { entries: dedupeEntries(entries) };
}

export function upsertPluginCatalogEntry(state: PluginCatalogState, entry: PluginCatalogEntry): PluginCatalogState {
  const existing = state.entries.findIndex((candidate) => candidate.id === entry.id);
  if (existing < 0) return { entries: [...state.entries, entry] };
  const entries = [...state.entries]; entries[existing] = entry;
  return { entries };
}

export function setPluginEnabled(state: PluginCatalogState, pluginId: string, enabled: boolean): PluginCatalogState {
  return { entries: state.entries.map((entry) => entry.id === pluginId && entry.trust !== 'blocked' ? { ...entry, enabled } : entry) };
}

function dedupeEntries(entries: PluginCatalogEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id); return true;
  });
}
