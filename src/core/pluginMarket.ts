import type { PluginPermission } from './types';
import type { PluginCatalogEntry, PluginCatalogState } from './pluginCatalog';

export interface PluginMarketRecord {
  id: string;
  name: string;
  version: string;
  description: string;
  packageUrl: string;
  integritySha256: string;
  signature: string;
  signer: string;
  /** Official signer key distributed by the trusted market index. */
  publicKey?: JsonWebKey;
  permissions: PluginPermission[];
}

export interface PluginMarketIndex { schema: 1; generatedAt: string; records: PluginMarketRecord[] }
export interface PluginMarketCache { url: string; fetchedAt: string; index: PluginMarketIndex }

export function parsePluginMarketIndex(input: unknown): PluginMarketIndex {
  if (typeof input !== 'object' || input === null) throw new Error('插件市场索引格式无效');
  const raw = input as Record<string, unknown>;
  if (raw.schema !== 1 || typeof raw.generatedAt !== 'string' || !Array.isArray(raw.records)) throw new Error('插件市场索引版本不受支持');
  const records = raw.records.filter(isMarketRecord);
  if (records.length !== raw.records.length) throw new Error('插件市场索引包含无效条目');
  return { schema: 1, generatedAt: raw.generatedAt, records };
}

export function mergeMarketIndex(state: PluginCatalogState, index: PluginMarketIndex): PluginCatalogState {
  return index.records.reduce((current, record) => {
    const entry: PluginCatalogEntry = {
      id: record.id, name: record.name, version: record.version, description: record.description,
      source: 'market', trust: 'blocked', permissions: record.permissions, enabled: false, packagePath: record.packageUrl,
    };
    const existing = current.entries.find((candidate) => candidate.id === record.id);
    return { entries: [...current.entries.filter((candidate) => candidate.id !== record.id), { ...entry, enabled: existing?.enabled ?? false }] };
  }, state);
}

export async function fetchPluginMarketIndex(url: string, fetcher: typeof fetch = fetch): Promise<PluginMarketIndex> {
  const response = await fetcher(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`插件市场请求失败：${response.status}`);
  return parsePluginMarketIndex(await response.json());
}

export function loadPluginMarketCache(storage: Pick<Storage, 'getItem'> = localStorage): PluginMarketCache | null {
  try {
    const raw = storage.getItem('aster.pluginMarketCache');
    if (!raw) return null;
    const value = JSON.parse(raw) as PluginMarketCache;
    return typeof value.url === 'string' && typeof value.fetchedAt === 'string' ? { ...value, index: parsePluginMarketIndex(value.index) } : null;
  } catch { return null; }
}

export function savePluginMarketCache(cache: PluginMarketCache, storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem('aster.pluginMarketCache', JSON.stringify(cache));
}

function isMarketRecord(value: unknown): value is PluginMarketRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return ['id', 'name', 'version', 'description', 'packageUrl', 'integritySha256', 'signature', 'signer'].every((key) => typeof record[key] === 'string')
    && (record.publicKey === undefined || (typeof record.publicKey === 'object' && record.publicKey !== null))
    && Array.isArray(record.permissions) && record.permissions.every((permission) => typeof permission === 'string');
}
