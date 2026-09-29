/**
 * Doc2X plugin contract checks (doc2x-translate-0).
 *
 * Verifies that the builtin `doc2x.core` plugin keeps its settings, provider
 * entry, panel and commands in sync with the CLI adapter in
 * `src/platform/doc2x`, and that the settings overlay values map onto valid
 * CLI arguments. Runs with the Node test runner; no Tauri, no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOC2X_PANEL_ID,
  DOC2X_PLUGIN_ID,
  DOC2X_PROVIDER_ID,
  createDoc2xPlugin,
  doc2xCommandHandlers,
  doc2xSettingContributions,
  doc2xSettingIds,
  setDoc2xCommandHandlers,
} from '../src/core/doc2xPlugin.ts';
import {
  defaultDoc2xTranslateSettings,
  doc2xConvertTransModes,
  doc2xExportFormats,
  doc2xIgnoreTranslateTypes,
  doc2xPdfFontStrategies,
  doc2xTargetLanguages,
  doc2xTranslateTypes,
} from '../src/platform/doc2x/doc2xCli.ts';
import {
  buildDoc2xRunPaths,
  createDoc2xRunId,
  parseDoc2xIgnoreTranslateTypes,
  readDoc2xTranslateSettings,
  resolveDoc2xSourcePath,
} from '../src/features/doc2x/doc2xSettings.ts';

function createFakeContext() {
  const settings = new Map();
  const providers = new Map();
  const panels = [];
  const commands = new Map();
  const context = {
    settings: { register: (contribution) => settings.set(contribution.id, contribution) },
    translationSources: {
      set: (id, contribution) => providers.set(id, contribution),
      delete: (id) => providers.delete(id),
    },
    workbenchPanels: { register: (panel) => panels.push(panel) },
    commands: { register: (command) => commands.set(command.id, command) },
  };
  return { context, settings, providers, panels, commands };
}

test('plugin manifest is a first-party, scene-less contribution', () => {
  const plugin = createDoc2xPlugin();
  assert.equal(plugin.id, DOC2X_PLUGIN_ID);
  assert.equal(plugin.manifest.distribution, 'builtin');
  assert.deepEqual(plugin.manifest.permissions, [
    'settings',
    'commands',
    'workbench',
    'providers',
    'events',
  ]);
});

test('activation registers settings, provider, panel and commands', () => {
  const { context, settings, providers, panels, commands } = createFakeContext();
  createDoc2xPlugin().activate(context);
  assert.equal(settings.size, doc2xSettingContributions.length);
  assert.equal(providers.get(DOC2X_PROVIDER_ID)?.id, DOC2X_PROVIDER_ID);
  assert.equal(panels[0]?.id, DOC2X_PANEL_ID);
  assert.equal(panels[0]?.sceneId, 'library');
  assert.equal(panels[0]?.area, 'right');
  assert.equal(panels[0]?.context, 'paper');
  assert.ok(commands.has('doc2x.account.login'));
  assert.ok(commands.has('doc2x.paper.translate'));
});

test('every CLI option has exactly one setting with a CLI default', () => {
  const ids = doc2xSettingContributions.map((contribution) => contribution.id);
  assert.equal(new Set(ids).size, ids.length, 'setting ids must be unique');
  const byId = new Map(doc2xSettingContributions.map((entry) => [entry.id, entry]));
  assert.equal(byId.get(doc2xSettingIds.translateType).defaultValue, defaultDoc2xTranslateSettings.translateType);
  assert.equal(byId.get(doc2xSettingIds.targetLanguage).defaultValue, defaultDoc2xTranslateSettings.targetLanguage);
  assert.equal(byId.get(doc2xSettingIds.targetModel).defaultValue, defaultDoc2xTranslateSettings.targetModel);
  assert.equal(byId.get(doc2xSettingIds.pdfFontStrategy).defaultValue, defaultDoc2xTranslateSettings.pdfFontStrategy);
  assert.equal(byId.get(doc2xSettingIds.convertTrans).defaultValue, defaultDoc2xTranslateSettings.convertTrans);
  assert.equal(byId.get(doc2xSettingIds.exportFormat).defaultValue, defaultDoc2xTranslateSettings.exportFormat);
  assert.equal(byId.get(doc2xSettingIds.contextualTranslation).defaultValue, false);
});

test('setting options match the CLI enumerations one to one', () => {
  const byId = new Map(doc2xSettingContributions.map((entry) => [entry.id, entry]));
  const values = (id) => (byId.get(id).options ?? []).map((option) => option.value).sort();
  assert.deepEqual(values(doc2xSettingIds.translateType), [...doc2xTranslateTypes].sort());
  assert.deepEqual(values(doc2xSettingIds.targetLanguage), [...doc2xTargetLanguages].sort());
  assert.deepEqual(values(doc2xSettingIds.pdfFontStrategy), [...doc2xPdfFontStrategies].sort());
  assert.deepEqual(values(doc2xSettingIds.convertTrans), [...doc2xConvertTransModes].sort());
  assert.deepEqual(values(doc2xSettingIds.exportFormat), [...doc2xExportFormats].sort());
});

test('plugin commands delegate to the handlers the host installs', async () => {
  const { context, commands } = createFakeContext();
  createDoc2xPlugin().activate(context);
  const restore = setDoc2xCommandHandlers({
    login: async () => '登录已启动',
    logout: async () => '未登录',
    accountStatus: async () => '剩余额度：100',
    translateCurrentPaper: async () => '已完成 1 篇翻译。',
  });
  try {
    assert.equal(await commands.get('doc2x.account.login').run(), '登录已启动');
    assert.equal(await commands.get('doc2x.account.logout').run(), '未登录');
    assert.equal(await commands.get('doc2x.account.status').run(), '剩余额度：100');
    assert.equal(await commands.get('doc2x.paper.translate').run(), '已完成 1 篇翻译。');
  } finally {
    restore();
  }
  assert.match(await doc2xCommandHandlers.login(), /未就绪/);
});

test('overlay values map onto valid CLI settings', () => {
  const resolution = readDoc2xTranslateSettings({
    [doc2xSettingIds.enabled]: true,
    [doc2xSettingIds.translateType]: 'md',
    [doc2xSettingIds.targetLanguage]: 'ja',
    [doc2xSettingIds.targetModel]: 'gpt-5.6-luna',
    [doc2xSettingIds.convertTrans]: 'translate',
    [doc2xSettingIds.contextualTranslation]: true,
    [doc2xSettingIds.ignoreTranslateTypes]: 'table, code',
    [doc2xSettingIds.exportFormat]: 'docx',
  });
  assert.equal(resolution.enabled, true);
  assert.deepEqual(resolution.errors, []);
  assert.equal(resolution.settings.translateType, 'md');
  assert.equal(resolution.settings.targetLanguage, 'ja');
  assert.equal(resolution.settings.targetModel, 'gpt-5.6-luna');
  assert.equal(resolution.settings.convertTrans, 'translate');
  assert.equal(resolution.settings.contextualTranslation, true);
  assert.deepEqual(resolution.settings.ignoreTranslateTypes, ['table', 'code']);
  assert.match(resolution.notices.join(' '), /docx 导出仅 V3 模型支持/);
});

test('invalid overlay values fall back to CLI defaults instead of a bad command', () => {
  const resolution = readDoc2xTranslateSettings({
    [doc2xSettingIds.translateType]: 'docx',
    [doc2xSettingIds.targetLanguage]: 'latin',
    [doc2xSettingIds.exportFormat]: 'pptx',
    [doc2xSettingIds.ignoreTranslateTypes]: 'table spreadsheet',
  });
  assert.equal(resolution.settings.translateType, defaultDoc2xTranslateSettings.translateType);
  assert.equal(resolution.settings.targetLanguage, defaultDoc2xTranslateSettings.targetLanguage);
  assert.equal(resolution.settings.exportFormat, defaultDoc2xTranslateSettings.exportFormat);
  assert.deepEqual(resolution.settings.ignoreTranslateTypes, ['table']);
  assert.deepEqual(resolution.errors, []);
});

test('fixed layout translation keeps the PDF export contract', () => {
  const resolution = readDoc2xTranslateSettings({
    [doc2xSettingIds.translateType]: 'pdf',
    [doc2xSettingIds.exportFormat]: 'md',
  });
  assert.equal(resolution.settings.exportFormat, 'md');
  assert.ok(
    resolution.errors.some((error) => error.includes('PDF')),
    `expected a blocking error, got ${JSON.stringify(resolution.errors)}`,
  );
});

test('ignore-translate-types parsing accepts the documented separators', () => {
  assert.deepEqual(parseDoc2xIgnoreTranslateTypes('table code'), ['table', 'code']);
  assert.deepEqual(parseDoc2xIgnoreTranslateTypes('table,code、figure'), ['table', 'code', 'figure']);
  assert.deepEqual(parseDoc2xIgnoreTranslateTypes(''), []);
  assert.deepEqual(parseDoc2xIgnoreTranslateTypes('spreadsheet'), []);
  assert.deepEqual([...doc2xIgnoreTranslateTypes].sort(), ['code', 'figure', 'reference', 'table']);
});

test('each run writes to its own directory under the paper folder', () => {
  const first = buildDoc2xRunPaths('D:/data/files/', 'paper-1', 'run-a');
  const second = buildDoc2xRunPaths('D:/data/files', 'paper-1', 'run-b');
  assert.equal(first.out, 'D:/data/files/translations/paper-1/run-a');
  assert.equal(first.receiptPath, 'D:/data/files/translations/paper-1/run-a/receipt.json');
  assert.notEqual(first.out, second.out);
  assert.match(createDoc2xRunId(Date.UTC(2026, 8, 28, 4, 5, 6)), /^run-2026-09-28T04-05-06/);
});

test('source paths resolve from the library files root', () => {
  const paper = { sourcePdf: 'files/abc.pdf' };
  assert.equal(resolveDoc2xSourcePath(paper, 'D:/data/files'), 'D:/data/files/files/abc.pdf');
  assert.equal(
    resolveDoc2xSourcePath({ sourcePdf: 'D:/elsewhere/abc.pdf' }, 'D:/data/files'),
    'D:/elsewhere/abc.pdf',
  );
  assert.equal(resolveDoc2xSourcePath({ sourcePdf: '  ' }, 'D:/data/files'), '');
});

