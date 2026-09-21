import { useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import type { SettingContribution } from '../../../core/types';
import { Button } from '../../../shared/ui';
import { zh } from '../../../ui/zh';
import { ActionRow, EmptyState, SettingField, SettingGroup, StatusLine } from '../primitives';
import type { LocalPluginSummary, PluginMarketSettingsState, PluginSettingValue, PluginSettingValues, SettingsExtensionCounts, SettingsPluginSummary } from '../types';
import { useAsyncStatus } from '../useAsyncStatus';

function truncate(value: string, max = 48) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function PluginsSection({ plugins, pluginSettings, pluginSettingValues, onTogglePlugin, onPluginSettingChange, extensionCounts, market, localPlugins, onImportPlugin, onMarketUrlChange, onRefreshMarket }: {
  plugins: SettingsPluginSummary[];
  pluginSettings: SettingContribution[];
  pluginSettingValues: PluginSettingValues;
  onTogglePlugin: (pluginId: string, enabled: boolean) => void;
  onPluginSettingChange: (settingId: string, value: PluginSettingValue) => void;
  extensionCounts: SettingsExtensionCounts;
  market: PluginMarketSettingsState;
  localPlugins: LocalPluginSummary[];
  onImportPlugin: () => void | Promise<void>;
  onMarketUrlChange: (url: string) => void;
  onRefreshMarket: () => void | Promise<void>;
}) {
  const [filter, setFilter] = useState('');
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const status = useAsyncStatus();
  const needle = filter.trim().toLowerCase();
  const matches = (value: string) => !needle || value.toLowerCase().includes(needle);
  const filteredPlugins = plugins.filter((plugin) => matches(`${plugin.name} ${plugin.id}`));
  const filteredMarket = market.records.filter((record) => matches(`${record.name} ${record.id} ${record.description}`));
  const filteredLocal = localPlugins.filter((plugin) => matches(`${plugin.name} ${plugin.id}`));
  const activeSettings = selectedPluginId ? pluginSettings.filter((setting) => setting.pluginId === selectedPluginId) : [];
  const activePlugin = plugins.find((plugin) => plugin.id === selectedPluginId) ?? null;
  return (
    <>
      <SettingGroup title={zh.settings.plugins} description={zh.settings.extensionSummary} anchorId="installed">
        <div className="extension-status-grid">
          <ExtensionCount label={zh.settings.extensionCommands} value={extensionCounts.commands} />
          <ExtensionCount label={zh.settings.extensionSettings} value={extensionCounts.settings} />
          <ExtensionCount label={zh.settings.extensionViews} value={extensionCounts.views} />
          <ExtensionCount label={zh.settings.extensionMetadata} value={extensionCounts.metadata} />
        </div>
        <SettingField id="setting-plugin-filter" label="筛选插件" description="按插件名称或 ID 过滤下方列表。" mode="label">
          <input type="search" value={filter} placeholder="例如 markdown" onChange={(event) => setFilter(event.target.value)} />
        </SettingField>
        <div className="plugin-runtime-list" id="setting-plugin-list" aria-live="polite">
          {filteredPlugins.length === 0 ? <EmptyState title="没有匹配的插件" description="清空筛选条件可以看到全部已安装插件。" /> : filteredPlugins.map((plugin) => (
            <div key={plugin.id} className={selectedPluginId === plugin.id ? 'plugin-runtime-item selected' : 'plugin-runtime-item'}>
              <label className="plugin-runtime-toggle">
                <input type="checkbox" checked={plugin.enabled} onChange={(event) => onTogglePlugin(plugin.id, event.target.checked)} aria-label={`启用 ${plugin.name}`} />
                <span className="plugin-runtime-text">
                  <strong>{plugin.name}</strong>
                  <small>{plugin.id} · {plugin.version ?? '0.0.0'} · {plugin.trust === 'builtin' ? '内置插件' : plugin.trust === 'trusted' ? '已验证插件' : '不可用'}</small>
                </span>
              </label>
              <div className="plugin-runtime-actions">
                <Button size="compact" className="plugin-runtime-settings" aria-label={`打开 ${plugin.name} 设置`} title={`打开 ${plugin.name} 设置`} onClick={() => setSelectedPluginId(plugin.id)}><SettingsIcon size={15} aria-hidden="true" /></Button>
              </div>
            </div>
          ))}
        </div>
      </SettingGroup>
      <SettingGroup title="插件设置" description={activePlugin ? `正在显示「${activePlugin.name}」的设置项。` : '选择插件行右侧的齿轮查看该插件的设置项。'} anchorId="plugin-settings">
        <div className="plugin-settings-list" id="setting-plugin-settings">
          {activeSettings.length === 0 ? <EmptyState title="尚未选择插件设置" description="点击插件右侧的齿轮按钮后，这里会列出该插件暴露的设置项。" /> : activeSettings.map((setting) => {
            const value = pluginSettingValues[setting.id] ?? setting.defaultValue;
            const controlId = `plugin-setting-${setting.id}`;
            return (
              <label key={setting.id} className="plugin-setting-row" htmlFor={controlId}>
                <span className="plugin-setting-text">
                  <strong>{setting.title}</strong>
                  {setting.description ? <small>{setting.description}</small> : null}
                </span>
                {setting.options?.length ? (
                  <select id={controlId} value={String(value)} onChange={(event) => onPluginSettingChange(setting.id, event.target.value)}>
                    {setting.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                ) : typeof value === 'boolean' ? (
                  <input id={controlId} type="checkbox" checked={value} onChange={(event) => onPluginSettingChange(setting.id, event.target.checked)} />
                ) : (
                  <input
                    id={controlId}
                    type={typeof value === 'number' ? 'number' : 'text'}
                    min={setting.id === 'markdown.documentFontSize' ? 10 : undefined}
                    max={setting.id === 'markdown.documentFontSize' ? 48 : undefined}
                    step={setting.id === 'markdown.documentFontSize' ? 1 : undefined}
                    value={String(value)}
                    onChange={(event) => onPluginSettingChange(setting.id, typeof value === 'number' ? clampPluginNumber(event.target.value, setting.id === 'markdown.documentFontSize' ? 10 : -100000, setting.id === 'markdown.documentFontSize' ? 48 : 100000, value) : event.target.value)}
                  />
                )}
              </label>
            );
          })}
        </div>
      </SettingGroup>
      <SettingGroup title="插件市场" description="索引来自下面的地址；刷新失败会保留上一次成功的结果。" anchorId="market" actions={<Button size="compact" disabled={market.loading} onClick={() => void status.run(() => onRefreshMarket(), { busy: '正在刷新市场索引…', success: () => '市场索引已刷新。', error: () => market.error ?? '刷新市场索引失败。' })}>刷新索引</Button>}>
        <SettingField id="setting-market-source" label="市场索引地址" description={market.fetchedAt ? `上次获取：${market.fetchedAt}` : '尚未成功获取过索引。'} mode="label">
          <span className="settings-market-source">
            <input type="url" value={market.url} placeholder="市场索引 URL" onChange={(event) => onMarketUrlChange(event.target.value)} />
            <Button pill onClick={() => void status.run(() => onRefreshMarket(), { busy: '正在刷新市场索引…', success: () => '市场索引已刷新。', error: () => market.error ?? '刷新市场索引失败。' })} disabled={market.loading}>{market.loading ? '刷新中…' : '刷新索引'}</Button>
          </span>
        </SettingField>
        <StatusLine tone={market.error ? 'error' : status.status.tone === 'error' ? 'error' : 'success'} message={market.error ?? status.status.message} />
        <div className="plugin-market-list" id="setting-market-list" aria-live="polite">
          {market.loading && market.records.length === 0 ? <p className="settings-muted" role="status">正在加载市场索引…</p> : filteredMarket.length === 0 ? <EmptyState title={market.records.length === 0 ? '市场索引为空' : '没有匹配的市场插件'} description={market.records.length === 0 ? '刷新索引后这里会列出可用插件。' : '调整筛选条件或清空搜索。'} /> : filteredMarket.map((record) => (
            <article key={record.id} className="plugin-market-item">
              <div className="plugin-market-item-heading"><strong>{record.name}</strong><span>{record.version ?? ''}</span></div>
              <p>{truncate(record.description ?? '', 160)}</p>
            </article>
          ))}
        </div>
      </SettingGroup>
      <SettingGroup title="本地插件包" description="只接受带签名的本地插件包；已阻止的包会被列出但不能启用。" anchorId="local">
        <ActionRow>
          <Button id="setting-import-plugin" variant="primary" pill onClick={() => void status.run(() => onImportPlugin(), { busy: '正在导入插件包…', success: () => '插件包已导入。', error: () => '导入插件包失败。' })}>导入已签名插件包</Button>
        </ActionRow>
        <div className="plugin-local-list">
          {filteredLocal.length === 0 ? <EmptyState title={localPlugins.length === 0 ? '尚未导入本地插件包' : '没有匹配的本地插件'} description="导入后的插件会显示签名状态与启用情况。" /> : filteredLocal.map((plugin) => (
            <div className="plugin-local-item" key={plugin.id}>
              <strong>{plugin.name}</strong>
              <small>{plugin.id} · v{plugin.version ?? '0.0.0'} · {plugin.status === 'verified' ? '已验证' : plugin.status === 'blocked' ? '已阻止' : '待接入'} · {plugin.enabled ? '已启用' : '已停用'}</small>
            </div>
          ))}
        </div>
      </SettingGroup>
    </>
  );
}

function ExtensionCount({ label, value }: { label: string; value: number }) {
  return <div className="extension-status-item"><span>{label}</span><strong>{value}</strong><em>{zh.settings.extensionEnabled}</em></div>;
}

function clampPluginNumber(value: string, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
