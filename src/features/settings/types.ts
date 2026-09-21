import type { ReaderLayout } from '../../core/types';
import type { PluginMarketRecord } from '../../core/pluginMarket';
import type { AppDiagnostics, AsterPaths, BackupResult } from '../../platform/nativeApi';

export type InterfaceDensity = 'compact' | 'comfortable';
export type InterfaceFont = 'sourceHanSans' | 'system';
export type InterfaceFontSize = number;
export type AppTheme = 'a4note' | 'paper' | 'midnight';
export type DocumentFont = 'sourceHanSans' | 'system' | 'serif';
export type CodeFont = 'firaCode' | 'systemMono';
export type DocumentFontSize = number;
export type DocumentLineHeight = 'compact' | 'relaxed';
export type DocumentLayout = 'fluid' | 'narrow';
export type MetadataSourcePreference = 'crossrefFirst' | 'arxivFirst' | 'localOnly';
export type PluginSettingValue = string | number | boolean;
export type PluginSettingValues = Record<string, PluginSettingValue>;
export type SettingsPathKind = 'root' | 'database' | 'files' | 'backups';

export type AppSettings = { density: InterfaceDensity; theme: AppTheme; fontFamily: InterfaceFont; interfaceFontSize: InterfaceFontSize; documentFontFamily: DocumentFont; codeFontFamily: CodeFont; documentLineHeight: DocumentLineHeight; documentLayout: DocumentLayout; defaultReaderLayout: ReaderLayout; metadataSourcePreference: MetadataSourcePreference; onlineMetadataEnabled: boolean; aiProviderId: string };

export type SettingsExtensionCounts = { commands: number; settings: number; views: number; metadata: number; translation: number; ai: number };
export type SettingsPluginSummary = { id: string; name: string; version?: string; trust?: 'builtin' | 'trusted' | 'untrusted' | 'blocked'; enabled: boolean };
export type LocalPluginSummary = SettingsPluginSummary & { source: 'local'; packagePath: string; status: 'verified' | 'blocked' | 'pending-runtime'; payload?: string; permissions?: import('../../core/types').PluginPermission[]; distribution?: 'local' | 'market'; integritySha256?: string; signature?: string; signer?: string };
export type SyncSettingsState = { supported: boolean; authenticated: boolean; username?: string; pendingOperations: number; lastSuccessAt?: string; lastError?: string; busy?: boolean };
export type PluginMarketSettingsState = { url: string; fetchedAt?: string; generatedAt?: string; records: PluginMarketRecord[]; loading?: boolean; error?: string };

/* Section identity is data, not a view concern: the shell, the search index and
   the section modules all agree on one ordered list. */
export const SETTINGS_SECTIONS = ['general', 'appearance', 'library', 'plugins', 'sync', 'updates', 'about'] as const;
export type Section = (typeof SETTINGS_SECTIONS)[number];
export const DEFAULT_SECTION: Section = 'general';

export function isSection(value: unknown): value is Section {
  return typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/* External callers hand us `initialSection` (including persisted or legacy values),
   so an unknown value must fall back instead of rendering an empty pane. */
export function normalizeSection(value: unknown, fallback: Section = DEFAULT_SECTION): Section {
  return isSection(value) ? value : fallback;
}

export const defaultSettings: AppSettings = { density: 'compact', theme: 'a4note', fontFamily: 'sourceHanSans', interfaceFontSize: 18, documentFontFamily: 'sourceHanSans', codeFontFamily: 'firaCode', documentLineHeight: 'relaxed', documentLayout: 'narrow', defaultReaderLayout: 'focus', metadataSourcePreference: 'crossrefFirst', onlineMetadataEnabled: true, aiProviderId: 'local-context-assistant' };

export type { AppDiagnostics, AsterPaths, BackupResult, PluginMarketRecord, ReaderLayout };
