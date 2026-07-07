import { useState } from 'react';
import { aiProviderStatusLabel } from '../../core/aiProviders';
import type { AiProviderContribution, ProviderContribution, ReaderLayout, SettingContribution } from '../../core/types';
import type { AppDiagnostics, AsterPaths, BackupResult } from '../../platform/nativeApi';
import { Button, Panel } from '../../shared/ui';
import { zh } from '../../ui/zh';

export type InterfaceDensity = 'compact' | 'comfortable';
export type MetadataSourcePreference = 'crossrefFirst' | 'arxivFirst' | 'localOnly';
export type PluginSettingValue = string | number | boolean;
export type PluginSettingValues = Record<string, PluginSettingValue>;
export type SettingsPathKind = 'root' | 'database' | 'files' | 'backups';

export type AppSettings = {
  density: InterfaceDensity;
  defaultReaderLayout: ReaderLayout;
  metadataSourcePreference: MetadataSourcePreference;
  onlineMetadataEnabled: boolean;
  aiProviderId: string;
};

export type SettingsExtensionCounts = {
  commands: number;
  settings: number;
  views: number;
  metadata: number;
  translation: number;
  ai: number;
};

export type SettingsPluginSummary = {
  id: string;
  name: string;
};

export const defaultSettings: AppSettings = {
  density: 'compact',
  defaultReaderLayout: 'focus',
  metadataSourcePreference: 'crossrefFirst',
  onlineMetadataEnabled: true,
  aiProviderId: 'local-context-assistant',
};

const settingsLayoutPresets: Array<{ id: ReaderLayout; label: string }> = [
  { id: 'focus', label: zh.reader.focusLayout },
  { id: 'note', label: zh.reader.noteLayout },
  { id: 'ai', label: zh.reader.aiLayout },
];

export function SettingsScene({
  settings,
  pluginSettings,
  pluginSettingValues,
  paths,
  diagnostics,
  aiProviders,
  providers,
  plugins,
  extensionCounts,
  onChange,
  onPluginSettingChange,
  onRefreshPaths,
  onRevealPath,
  onCreateBackup,
  onRestoreBackup,
}: {
  settings: AppSettings;
  pluginSettings: SettingContribution[];
  pluginSettingValues: PluginSettingValues;
  paths: AsterPaths | null;
  diagnostics: AppDiagnostics | null;
  aiProviders: AiProviderContribution[];
  providers: ProviderContribution[];
  plugins: SettingsPluginSummary[];
  extensionCounts: SettingsExtensionCounts;
  onChange: (settings: AppSettings) => void;
  onPluginSettingChange: (settingId: string, value: PluginSettingValue) => void;
  onRefreshPaths: () => void | Promise<void>;
  onRevealPath: (kind: SettingsPathKind) => void | Promise<void>;
  onCreateBackup: () => Promise<BackupResult>;
  onRestoreBackup: () => Promise<void>;
}) {
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => onChange({ ...settings, [key]: value });
  const [copyStatus, setCopyStatus] = useState('');
  const [backupStatus, setBackupStatus] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopyStatus(zh.settings.pathCopied);
      window.setTimeout(() => setCopyStatus(''), 1600);
    } catch {
      setCopyStatus(zh.settings.pathCopyFailed);
    }
  };
  const copyDiagnostics = async () => {
    const lines = [
      `Aster diagnostics`,
      `${zh.settings.productName}: ${diagnostics?.product_name ?? 'Aster'}`,
      `${zh.settings.version}: ${diagnostics?.version ?? '0.1.0'}`,
      `${zh.settings.identifier}: ${diagnostics?.identifier ?? 'app.aster.research'}`,
      `${zh.settings.platform}: ${diagnostics?.platform ?? zh.settings.pathUnavailable}`,
      `${zh.settings.dataRoot}: ${diagnostics?.data_root ?? paths?.root ?? zh.settings.pathUnavailable}`,
      `${zh.settings.databasePath}: ${paths?.database ?? zh.settings.pathUnavailable}`,
      `${zh.settings.filesPath}: ${paths?.files_root ?? zh.settings.pathUnavailable}`,
      `${zh.settings.paperCount}: ${diagnostics?.paper_count ?? '-'}`,
      `${zh.settings.sourcePdfCount}: ${diagnostics?.source_pdf_count ?? '-'}`,
      `${zh.settings.translatedPdfCount}: ${diagnostics?.translated_pdf_count ?? '-'}`,
      `${zh.settings.noteCount}: ${diagnostics?.note_count ?? '-'}`,
      `${zh.settings.annotationCount}: ${diagnostics?.annotation_count ?? '-'}`,
      `${zh.settings.aiThreadCount}: ${diagnostics?.ai_thread_count ?? '-'}`,
      `${zh.settings.missingFileCount}: ${diagnostics?.missing_file_count ?? '-'}`,
      `${zh.settings.databaseSize}: ${formatBytes(diagnostics?.database_size_bytes)}`,
      `${zh.settings.filesSize}: ${formatBytes(diagnostics?.files_size_bytes)}`,
      `${zh.settings.density}: ${settings.density}`,
      `${zh.settings.defaultReaderLayout}: ${settings.defaultReaderLayout}`,
      `AI Provider: ${settings.aiProviderId}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyStatus(zh.settings.diagnosticsCopied);
      window.setTimeout(() => setCopyStatus(''), 1600);
    } catch {
      setCopyStatus(zh.settings.pathCopyFailed);
    }
  };
  const createBackup = async () => {
    setBackupBusy(true);
    setBackupStatus('');
    try {
      const result = await onCreateBackup();
      setBackupStatus(`${zh.settings.backupCreated}：${result.backup_path}`);
    } catch {
      setBackupStatus(zh.settings.backupFailed);
    } finally {
      setBackupBusy(false);
    }
  };
  const restoreBackup = async () => {
    setRestoreBusy(true);
    setBackupStatus('');
    try {
      await onRestoreBackup();
    } catch {
      setBackupStatus(zh.settings.restoreFailed);
    } finally {
      setRestoreBusy(false);
    }
  };
  return (
    <section className="scene active">
      <header className="topbar compact">
        <div>
          <h1>{zh.settings.title}</h1>
          <p className="scene-description">{zh.settings.subtitle}</p>
        </div>
      </header>
      <div className="settings-grid">
        <Panel title={zh.settings.language}>
          <p>{zh.settings.chinese}</p>
        </Panel>
        <Panel title={zh.settings.density}>
          <div className="settings-control-row">
            <Button active={settings.density === 'compact'} onClick={() => update('density', 'compact')}>
              {zh.settings.compact}
            </Button>
            <Button active={settings.density === 'comfortable'} onClick={() => update('density', 'comfortable')}>
              {zh.settings.comfortable}
            </Button>
          </div>
        </Panel>
        <Panel title={zh.settings.defaultReaderLayout}>
          <select value={settings.defaultReaderLayout} onChange={(event) => update('defaultReaderLayout', event.target.value as ReaderLayout)}>
            {settingsLayoutPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </Panel>
        <Panel title={zh.settings.metadataSources}>
          <select value={settings.metadataSourcePreference} onChange={(event) => update('metadataSourcePreference', event.target.value as MetadataSourcePreference)}>
            <option value="crossrefFirst">{zh.settings.crossrefFirst}</option>
            <option value="arxivFirst">{zh.settings.arxivFirst}</option>
            <option value="localOnly">{zh.settings.localOnly}</option>
          </select>
          <label className="settings-check">
            <input type="checkbox" checked={settings.onlineMetadataEnabled} onChange={(event) => update('onlineMetadataEnabled', event.target.checked)} />
            {zh.settings.enableOnlineMetadata}
          </label>
        </Panel>
        <div className="soft-panel">
          <div className="panel-title">AI Provider</div>
          <select value={settings.aiProviderId} onChange={(event) => update('aiProviderId', event.target.value)}>
            {aiProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name} · {aiProviderStatusLabel(provider.status)}
              </option>
            ))}
          </select>
          <div className="provider-section">
            {aiProviders.map((provider) => (
              <div key={provider.id} className={settings.aiProviderId === provider.id ? 'ai-provider-card active' : 'ai-provider-card'}>
                <strong>{provider.name}</strong>
                <span>{provider.modelLabel ?? provider.kind}</span>
                <em>{provider.description ?? provider.id}</em>
              </div>
            ))}
          </div>
        </div>
        <div className="soft-panel">
          <div className="panel-title">{zh.settings.library}</div>
          <p>{zh.settings.localLibrary}</p>
          <div className="settings-paths">
            <PathRow label={zh.settings.libraryRoot} value={paths?.root ?? zh.settings.pathUnavailable} onCopy={copyPath} />
            <PathRow label={zh.settings.databasePath} value={paths?.database ?? zh.settings.pathUnavailable} onCopy={copyPath} />
            <PathRow label={zh.settings.filesPath} value={paths?.files_root ?? zh.settings.pathUnavailable} onCopy={copyPath} />
          </div>
          <div className="settings-control-row settings-path-actions">
            <button type="button" onClick={() => void onRevealPath('root')} disabled={!paths}>
              {zh.settings.openLibraryRoot}
            </button>
            <button type="button" onClick={() => void onRevealPath('files')} disabled={!paths}>
              {zh.settings.openFilesPath}
            </button>
            <button type="button" onClick={() => void onRevealPath('backups')} disabled={!paths}>
              {zh.settings.openBackupsPath}
            </button>
            <button type="button" onClick={() => void onRefreshPaths()}>
              {zh.settings.refreshPaths}
            </button>
            {copyStatus && <span>{copyStatus}</span>}
          </div>
          <div className="settings-backup-row">
            <Button variant="primary" pill onClick={() => void createBackup()} disabled={backupBusy || !paths}>
              {backupBusy ? zh.settings.backupRunning : zh.settings.createBackup}
            </Button>
            <Button pill onClick={() => void restoreBackup()} disabled={restoreBusy || !paths}>
              {restoreBusy ? zh.settings.restoreRunning : zh.settings.restoreBackup}
            </Button>
            {backupStatus && <span title={backupStatus}>{backupStatus}</span>}
          </div>
        </div>
        <div className="soft-panel">
          <div className="panel-title">{zh.settings.plugins}</div>
          <p>{zh.settings.extensionSummary}</p>
          <div className="extension-status-grid">
            <ExtensionStatus label={zh.settings.extensionCommands} value={extensionCounts.commands} status={zh.settings.extensionEnabled} />
            <ExtensionStatus label={zh.settings.extensionEvents} value="document.*" status={zh.settings.extensionEnabled} />
            <ExtensionStatus label={zh.settings.extensionSettings} value={extensionCounts.settings} status={zh.settings.extensionEnabled} />
            <ExtensionStatus label={zh.settings.extensionViews} value={extensionCounts.views} status={zh.settings.extensionEnabled} />
            <ExtensionStatus label={zh.settings.extensionMetadata} value={extensionCounts.metadata} status={zh.settings.extensionEnabled} />
            <ExtensionStatus label={zh.settings.extensionTranslation} value={extensionCounts.translation} status={zh.settings.extensionEnabled} />
            <ExtensionStatus label={zh.settings.extensionAi} value={extensionCounts.ai} status={zh.settings.extensionEnabled} />
          </div>
          <div className="provider-section">
            <span>{zh.settings.builtInProviders}</span>
            <div className="provider-list">
              {providers.map((provider) => (
                <span key={provider.id} className="provider-chip" title={provider.id}>
                  {provider.name}
                </span>
              ))}
            </div>
          </div>
          <div className="provider-section">
            <span>{plugins.length ? zh.settings.pluginCount(plugins.length) : zh.settings.noRegisteredPlugins}</span>
            <div className="provider-list">
              {plugins.length ? (
                plugins.map((plugin) => (
                  <span key={plugin.id} className="provider-chip" title={plugin.id}>
                    {plugin.name}
                  </span>
                ))
              ) : (
                <span className="provider-chip muted">{zh.settings.extensionLocalOnly}</span>
              )}
            </div>
          </div>
          <PluginSettingsList settings={pluginSettings} values={pluginSettingValues} onChange={onPluginSettingChange} />
        </div>
        <div className="soft-panel">
          <div className="panel-title">{zh.settings.about}</div>
          <div className="diagnostics-grid">
            <DiagnosticItem label={zh.settings.productName} value={diagnostics?.product_name ?? 'Aster'} />
            <DiagnosticItem label={zh.settings.version} value={diagnostics?.version ?? '0.1.0'} />
            <DiagnosticItem label={zh.settings.identifier} value={diagnostics?.identifier ?? 'app.aster.research'} />
            <DiagnosticItem label={zh.settings.platform} value={diagnostics?.platform ?? zh.settings.pathUnavailable} />
            <DiagnosticItem label={zh.settings.dataRoot} value={diagnostics?.data_root ?? paths?.root ?? zh.settings.pathUnavailable} />
            <DiagnosticItem label={zh.settings.paperCount} value={numberDiagnostic(diagnostics?.paper_count)} />
            <DiagnosticItem label={zh.settings.sourcePdfCount} value={numberDiagnostic(diagnostics?.source_pdf_count)} />
            <DiagnosticItem label={zh.settings.translatedPdfCount} value={numberDiagnostic(diagnostics?.translated_pdf_count)} />
            <DiagnosticItem label={zh.settings.noteCount} value={numberDiagnostic(diagnostics?.note_count)} />
            <DiagnosticItem label={zh.settings.annotationCount} value={numberDiagnostic(diagnostics?.annotation_count)} />
            <DiagnosticItem label={zh.settings.aiThreadCount} value={numberDiagnostic(diagnostics?.ai_thread_count)} />
            <DiagnosticItem label={zh.settings.missingFileCount} value={numberDiagnostic(diagnostics?.missing_file_count)} />
            <DiagnosticItem label={zh.settings.databaseSize} value={formatBytes(diagnostics?.database_size_bytes)} />
            <DiagnosticItem label={zh.settings.filesSize} value={formatBytes(diagnostics?.files_size_bytes)} />
          </div>
          <div className="settings-control-row settings-path-actions">
            <button type="button" onClick={() => void copyDiagnostics()}>
              {zh.settings.copyDiagnostics}
            </button>
            {copyStatus && <span>{copyStatus}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

function DiagnosticItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <code title={value}>{value}</code>
    </div>
  );
}

function PluginSettingsList({
  settings,
  values,
  onChange,
}: {
  settings: SettingContribution[];
  values: PluginSettingValues;
  onChange: (settingId: string, value: PluginSettingValue) => void;
}) {
  return (
    <div className="plugin-settings-list">
      <div className="panel-title">插件设置</div>
      {settings.length ? (
        settings.map((setting) => {
          const value = values[setting.id] ?? setting.defaultValue;
          return (
            <label key={setting.id} className="plugin-setting-row">
              <span>
                <strong>{setting.title}</strong>
                <em>{setting.id}</em>
              </span>
              {typeof setting.defaultValue === 'boolean' ? (
                <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(setting.id, event.target.checked)} />
              ) : typeof setting.defaultValue === 'number' ? (
                <input type="number" value={Number(value)} onChange={(event) => onChange(setting.id, Number(event.target.value))} />
              ) : (
                <input type="text" value={String(value)} onChange={(event) => onChange(setting.id, event.target.value)} />
              )}
            </label>
          );
        })
      ) : (
        <div className="mini-message">当前没有插件贡献的设置项。</div>
      )}
    </div>
  );
}

function ExtensionStatus({ label, value, status }: { label: string; value: string | number; status: string }) {
  return (
    <div className="extension-status-item">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{status}</em>
    </div>
  );
}

function PathRow({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string) => void | Promise<void> }) {
  const canCopy = value && value !== zh.settings.pathUnavailable;
  return (
    <div className="settings-path-row">
      <span>{label}</span>
      <code title={value}>{value}</code>
      <button type="button" onClick={() => void onCopy(value)} disabled={!canCopy}>
        {zh.settings.copyPath}
      </button>
    </div>
  );
}

function numberDiagnostic(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '-';
}

function formatBytes(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unitIndex]}`;
}
