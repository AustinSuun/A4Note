import type { AsterPluginManifest } from './types.ts';
import { parsePluginManifest } from './types.ts';

export interface PluginPackageEnvelope {
  schema: 1;
  manifest: AsterPluginManifest;
  /** Signed package payload. Runtime loading is deliberately handled separately. */
  payload: string;
}

export function parsePluginPackageEnvelope(input: unknown): PluginPackageEnvelope {
  if (typeof input !== 'object' || input === null) throw new Error('插件包格式无效');
  const raw = input as Record<string, unknown>;
  if (raw.schema !== 1 || typeof raw.payload !== 'string') throw new Error('插件包版本不受支持');
  const manifest = parsePluginManifest(raw.manifest);
  if (manifest.distribution !== 'local' && manifest.distribution !== 'market') throw new Error('只能导入本地或官方市场插件');
  if (!manifest.integritySha256 || !manifest.signature || !manifest.signer) throw new Error('插件包缺少完整性或签名信息');
  return { schema: 1, manifest, payload: raw.payload };
}
