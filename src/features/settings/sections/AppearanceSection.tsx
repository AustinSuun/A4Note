import { Button } from '../../../shared/ui';
import { zh } from '../../../ui/zh';
import { ActionRow, SettingField, SettingGroup } from '../primitives';
import type { AppSettings, AppTheme, CodeFont, DocumentFont, DocumentLayout, DocumentLineHeight, InterfaceFont } from '../types';

export function clampSettingNumber(value: string, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function AppearanceSection({ settings, onChange }: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => onChange({ ...settings, [key]: value });
  return (
    <>
      <SettingGroup title="主题与界面字体" description="主题同时影响工作台、Markdown 文档和阅读界面。" anchorId="theme">
        <SettingField id="setting-theme" label="主题预设" description="A4 Note 是默认配色，深夜专注适合弱光环境。" mode="label">
          <select value={settings.theme} onChange={(event) => update('theme', event.target.value as AppTheme)}>
            <option value="a4note">A4 Note（默认）</option>
            <option value="paper">纸张浅色</option>
            <option value="midnight">深夜专注</option>
          </select>
        </SettingField>
        <SettingField id="setting-interface-font" label="界面字体" description="工具栏、侧边栏与设置界面使用的字体。" mode="label">
          <select value={settings.fontFamily} onChange={(event) => update('fontFamily', event.target.value as InterfaceFont)}>
            <option value="sourceHanSans">{zh.settings.sourceHanSans}</option>
            <option value="system">{zh.settings.systemFont}</option>
          </select>
        </SettingField>
        <SettingField id="setting-interface-font-size" label={zh.settings.fontFamily === '界面字体' ? '界面字号' : '界面字号'} description="只调整界面文字，不改变控件尺寸与布局；可用方向键微调。" mode="label">
          <span className="settings-range-input">
            <input type="range" min="10" max="32" step="1" value={settings.interfaceFontSize} aria-label="界面字号滑块" onChange={(event) => update('interfaceFontSize', clampSettingNumber(event.target.value, 10, 32, 18))} />
            <output htmlFor="setting-interface-font-size" aria-live="off">{settings.interfaceFontSize}px</output>
          </span>
        </SettingField>
      </SettingGroup>
      <SettingGroup title="文档排版" description="只影响 Markdown 与笔记正文，不改变界面控件。" anchorId="document">
        <SettingField id="setting-document-font" label="文档正文字体" description="正文使用的字体族。" mode="label">
          <select value={settings.documentFontFamily} onChange={(event) => update('documentFontFamily', event.target.value as DocumentFont)}>
            <option value="sourceHanSans">{zh.settings.sourceHanSans}</option>
            <option value="system">{zh.settings.systemFont}</option>
            <option value="serif">系统衬线字体</option>
          </select>
        </SettingField>
        <SettingField id="setting-code-font" label="代码字体" description="代码块与行内代码使用的等宽字体。" mode="label">
          <select value={settings.codeFontFamily} onChange={(event) => update('codeFontFamily', event.target.value as CodeFont)}>
            <option value="firaCode">FiraCode Nerd Font Mono</option>
            <option value="systemMono">系统等宽字体</option>
          </select>
        </SettingField>
        <SettingField id="setting-line-height" label="文档行距" description="正文行距，紧凑适合快速浏览。">
          <ActionRow>
            <Button active={settings.documentLineHeight === 'compact'} aria-pressed={settings.documentLineHeight === 'compact'} onClick={() => update('documentLineHeight', 'compact')}>{zh.settings.compact}</Button>
            <Button active={settings.documentLineHeight === 'relaxed'} aria-pressed={settings.documentLineHeight === 'relaxed'} onClick={() => update('documentLineHeight', 'relaxed')}>{zh.settings.comfortable}</Button>
          </ActionRow>
        </SettingField>
        <SettingField id="setting-document-layout" label="文档版式" description="窄栏更接近纸张阅读宽度。" mode="label">
          <select value={settings.documentLayout} onChange={(event) => update('documentLayout', event.target.value as DocumentLayout)}>
            <option value="narrow">窄栏</option>
            <option value="fluid">流式</option>
          </select>
        </SettingField>
      </SettingGroup>
    </>
  );
}
