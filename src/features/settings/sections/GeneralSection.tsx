import { aiProviderStatusLabel } from '../../../core/aiProviders';
import type { AiProviderContribution, ReaderLayout } from '../../../core/types';
import { Button } from '../../../shared/ui';
import { zh } from '../../../ui/zh';
import { ActionRow, SettingField, SettingGroup, ToggleRow } from '../primitives';
import type { AppSettings, MetadataSourcePreference } from '../types';

const layouts: Array<{ id: ReaderLayout; label: string }> = [{ id: 'focus', label: zh.reader.focusLayout }, { id: 'note', label: zh.reader.noteLayout }, { id: 'ai', label: zh.reader.aiLayout }];

export function GeneralSection({ settings, onChange, aiProviders }: { settings: AppSettings; onChange: (settings: AppSettings) => void; aiProviders: AiProviderContribution[] }) {
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => onChange({ ...settings, [key]: value });
  return (
    <>
      <SettingGroup title={zh.settings.language} description={zh.settings.subtitle} anchorId="language">
        <SettingField id="setting-language" label={zh.settings.language} description="当前界面语言，切换后立即生效。">
          <span className="settings-value-static">{zh.settings.chinese}</span>
        </SettingField>
      </SettingGroup>
      <SettingGroup title="界面与阅读" description="界面密度与打开 PDF 时的默认布局。" anchorId="interface">
        <SettingField id="setting-density" label={zh.settings.density} description="紧凑更适合小窗口，舒适会放宽行距。">
          <ActionRow>
            <Button active={settings.density === 'compact'} aria-pressed={settings.density === 'compact'} onClick={() => update('density', 'compact')}>{zh.settings.compact}</Button>
            <Button active={settings.density === 'comfortable'} aria-pressed={settings.density === 'comfortable'} onClick={() => update('density', 'comfortable')}>{zh.settings.comfortable}</Button>
          </ActionRow>
        </SettingField>
        <SettingField id="setting-reader-layout" label={zh.settings.defaultReaderLayout} description="打开文献后默认使用的工作区布局。" mode="label">
          <select value={settings.defaultReaderLayout} onChange={(event) => update('defaultReaderLayout', event.target.value as ReaderLayout)}>
            {layouts.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </SettingField>
      </SettingGroup>
      <SettingGroup title={zh.settings.metadataSources} description="导入文献时用于补全标题、作者与 DOI 的来源。" anchorId="metadata">
        <SettingField id="setting-metadata-sources" label={zh.settings.metadataSources} description="越靠前的来源优先命中。" mode="label">
          <select value={settings.metadataSourcePreference} onChange={(event) => update('metadataSourcePreference', event.target.value as MetadataSourcePreference)}>
            <option value="crossrefFirst">{zh.settings.crossrefFirst}</option>
            <option value="arxivFirst">{zh.settings.arxivFirst}</option>
            <option value="localOnly">{zh.settings.localOnly}</option>
          </select>
        </SettingField>
        <div id="setting-online-metadata">
          <ToggleRow id="setting-online-metadata-toggle" label={zh.settings.enableOnlineMetadata} description="关闭后只从本地文件提取元数据，不再联网。" checked={settings.onlineMetadataEnabled} onChange={(checked) => update('onlineMetadataEnabled', checked)} />
        </div>
      </SettingGroup>
      <SettingGroup title="AI Provider" description="决定 AI 场景使用哪个 Provider，状态为不可用时自动回退本地上下文。" anchorId="ai">
        <SettingField id="setting-ai-provider" label="AI Provider" description="内置 Provider 始终可用，外部 Provider 需要配置后才能选择。" mode="label">
          <select value={settings.aiProviderId} onChange={(event) => update('aiProviderId', event.target.value)}>
            {aiProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} - {aiProviderStatusLabel(provider.status)}</option>)}
          </select>
        </SettingField>
        <p className="settings-muted">当前共 {aiProviders.length} 个 Provider 可用于 AI 场景。</p>
      </SettingGroup>
    </>
  );
}
