import type { AsterPlugin, SettingContribution } from './types';

export const DOC2X_PLUGIN_ID = 'doc2x.core';
export const DOC2X_PANEL_ID = 'plugin:doc2x.core.panel';
export const DOC2X_PROVIDER_ID = 'doc2x';

/** Setting ids owned by the plugin. The UI overlay aggregates them by id. */
export const doc2xSettingIds = {
  enabled: 'doc2x.core.enabled',
  translateType: 'doc2x.core.translateType',
  targetLanguage: 'doc2x.core.targetLanguage',
  targetModel: 'doc2x.core.targetModel',
  termId: 'doc2x.core.termId',
  pdfFontStrategy: 'doc2x.core.pdfFontStrategy',
  convertTrans: 'doc2x.core.convertTrans',
  contextualTranslation: 'doc2x.core.contextualTranslation',
  ignoreTranslateTypes: 'doc2x.core.ignoreTranslateTypes',
  exportFormat: 'doc2x.core.exportFormat',
} as const;

export interface Doc2xSettingOption {
  value: string;
  label: string;
}

// 选项集合与 `doc2x translate --help` 一一对应；
// scripts/verify-doc2x-plugin.mjs 会把这里与 src/platform/doc2x 的常量逐一比对，
// 避免设置面板和 CLI 参数脱节。
export const doc2xTranslateTypeOptions: Doc2xSettingOption[] = [
  { value: 'pdf', label: '保留排版 PDF（原稿在左、译文在右）' },
  { value: 'md', label: '重排文档（Markdown/Word 等）' },
];

export const doc2xTargetLanguageOptions: Doc2xSettingOption[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'pt', label: 'Português' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'ru', label: 'Русский' },
  { value: 'ar', label: 'العربية' },
];

export const doc2xPdfFontStrategyOptions: Doc2xSettingOption[] = [
  { value: 'global-consistent', label: '全局一致（推荐）' },
  { value: 'page-optimal', label: '逐页最优' },
];

export const doc2xConvertTransOptions: Doc2xSettingOption[] = [
  { value: 'both', label: '原文 + 译文（保留排版必需）' },
  { value: 'origin', label: '仅原文' },
  { value: 'translate', label: '仅译文' },
];

export const doc2xExportFormatOptions: Doc2xSettingOption[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Word（docx，V3 模型）' },
  { value: 'md', label: 'Markdown' },
  { value: 'tex', label: 'LaTeX' },
  { value: 'html', label: 'HTML' },
  { value: 'none', label: '不导出（仅解析）' },
];

export const doc2xIgnoreTranslateTypeOptions: Doc2xSettingOption[] = [
  { value: 'table', label: '表格' },
  { value: 'code', label: '代码' },
  { value: 'figure', label: '图片' },
  { value: 'reference', label: '参考文献' },
];

/**
 * Settings the panel exposes. Every entry maps to exactly one CLI flag so the
 * UI can be validated against `doc2x translate --help` in tests.
 */
export const doc2xSettingContributions: SettingContribution[] = [
  {
    id: doc2xSettingIds.enabled,
    title: '启用 Doc2X 翻译入口',
    description: '关闭后文献库不再显示 Doc2X 面板与翻译入口，本机已安装的 CLI 不受影响。',
    defaultValue: true,
    sceneId: 'library',
  },
  {
    id: doc2xSettingIds.translateType,
    title: '翻译模式（--translate-type）',
    description: 'pdf 保留排版并固定导出 PDF；md 为重排文档，可导出 docx/md/tex/html。',
    defaultValue: 'pdf',
    options: doc2xTranslateTypeOptions,
    sceneId: 'library',
  },
  {
    id: doc2xSettingIds.targetLanguage,
    title: '目标语言（--target-language）',
    description: '译文语言，列表与 CLI 支持的语言一致。',
    defaultValue: 'zh',
    options: doc2xTargetLanguageOptions,
    sceneId: 'library',
  },
  {
    id: doc2xSettingIds.targetModel,
    title: '翻译模型 ID（--target-model）',
    description: '默认 10001 为免费模型；其余模型 ID 用 doc2x models list 查询，部分模型需要订阅。',
    defaultValue: '10001',
    sceneId: 'library',
  },
  {
    id: doc2xSettingIds.termId,
    title: '术语表 ID（--term-id）',
    description: '留空表示不使用术语表；ID 来自 Doc2X 网页端术语表。',
    defaultValue: '',
    sceneId: 'library',
  },
  {
    id: doc2xSettingIds.pdfFontStrategy,
    title: 'PDF 字体策略（--pdf-font-strategy）',
    description: '仅保留排版（pdf）翻译生效。',
    defaultValue: 'global-consistent',
    options: doc2xPdfFontStrategyOptions,
    sceneId: 'library',
  },
  {
    id: doc2xSettingIds.convertTrans,
    title: '双语排布（--convert-trans）',
    description: '保留排版 PDF 固定为「原文 + 译文」。',
    defaultValue: 'both',
    options: doc2xConvertTransOptions,
    sceneId: 'library',
  },
  {
    id: doc2xSettingIds.contextualTranslation,
    title: '上下文增强翻译（--contextual-translation）',
    description: '按上下文整篇翻译，耗时更长、质量更稳。',
    defaultValue: false,
    sceneId: 'library',
  },
  {
    id: doc2xSettingIds.ignoreTranslateTypes,
    title: '忽略翻译类型（--ignore-translate-types）',
    description: '空格或逗号分隔：table code figure reference；留空表示全部翻译。',
    defaultValue: '',
    sceneId: 'library',
  },
  {
    id: doc2xSettingIds.exportFormat,
    title: '导出格式（--to）',
    description: '重排模式可选 pdf/docx/md/tex/html；保留排版模式固定 pdf。',
    defaultValue: 'pdf',
    options: doc2xExportFormatOptions,
    sceneId: 'library',
  },
];

/**
 * Port the core plugin declares for the UI layer. Core must not import
 * `src/platform`, so the host wires these handlers once at startup.
 */
export interface Doc2xCommandHandlers {
  login(): Promise<string>;
  logout(): Promise<string>;
  accountStatus(): Promise<string>;
  translateCurrentPaper(): Promise<string>;
}

const unavailable = (action: string) => async () =>
  `Doc2X 插件未就绪：${action} 需要先启用 doc2x.core 插件。`;

export const doc2xCommandHandlers: Doc2xCommandHandlers = {
  login: unavailable('登录'),
  logout: unavailable('退出登录'),
  accountStatus: unavailable('账号状态'),
  translateCurrentPaper: unavailable('翻译'),
};

/** Install real handlers; returns a restore function used by tests. */
export function setDoc2xCommandHandlers(
  handlers: Partial<Doc2xCommandHandlers>,
): () => void {
  const previous = { ...doc2xCommandHandlers };
  Object.assign(doc2xCommandHandlers, handlers);
  return () => {
    Object.assign(doc2xCommandHandlers, previous);
  };
}

/**
 * First-party plugin that turns the Doc2X CLI into a library surface:
 * settings, a translation provider entry and the library workbench panel.
 * The CLI execution layer itself ships with the main bundle.
 */
export function createDoc2xPlugin(): AsterPlugin {
  return {
    id: DOC2X_PLUGIN_ID,
    name: 'A4 Note Doc2X 翻译',
    manifest: {
      id: DOC2X_PLUGIN_ID,
      name: 'A4 Note Doc2X 翻译',
      version: '1.0.0',
      distribution: 'builtin',
      permissions: ['settings', 'commands', 'workbench', 'providers', 'events'],
    },
    activate: (context) => {
      for (const contribution of doc2xSettingContributions) {
        context.settings.register(contribution);
      }
      context.translationSources.set(DOC2X_PROVIDER_ID, {
        id: DOC2X_PROVIDER_ID,
        name: 'Doc2X 翻译（本机 CLI）',
        enabledByDefault: true,
      });
      context.workbenchPanels.register({
        id: DOC2X_PANEL_ID,
        sceneId: 'library',
        area: 'right',
        commandId: 'doc2x.panel.translate',
        titleKey: 'doc2x.panel',
        icon: 'translate',
        order: 30,
        source: `plugin:${DOC2X_PLUGIN_ID}`,
        context: 'paper',
      });
      const source = `plugin:${DOC2X_PLUGIN_ID}`;
      context.commands.register({
        id: 'doc2x.account.login',
        title: 'Doc2X：登录自有账号',
        source,
        run: () => doc2xCommandHandlers.login(),
      });
      context.commands.register({
        id: 'doc2x.account.logout',
        title: 'Doc2X：退出登录',
        source,
        run: () => doc2xCommandHandlers.logout(),
      });
      context.commands.register({
        id: 'doc2x.account.status',
        title: 'Doc2X：查看账号额度与订阅',
        source,
        run: () => doc2xCommandHandlers.accountStatus(),
      });
      context.commands.register({
        id: 'doc2x.paper.translate',
        title: 'Doc2X：翻译当前文献',
        source,
        run: () => doc2xCommandHandlers.translateCurrentPaper(),
      });
    },
  };
}

