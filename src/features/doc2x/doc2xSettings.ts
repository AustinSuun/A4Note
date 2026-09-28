import {
  defaultDoc2xTranslateSettings,
  doc2xConvertTransModes,
  doc2xExportFormats,
  doc2xIgnoreTranslateTypes,
  doc2xPdfFontStrategies,
  doc2xTargetLanguages,
  doc2xTranslateTypes,
  validateDoc2xTranslateSettings,
  type Doc2xConvertTrans,
  type Doc2xExportFormat,
  type Doc2xIgnoreTranslateType,
  type Doc2xPdfFontStrategy,
  type Doc2xTargetLanguage,
  type Doc2xTranslateSettings,
  type Doc2xTranslateType,
} from '../../platform/doc2x/doc2xCli.ts';
import { doc2xSettingIds } from '../../core/doc2xPlugin.ts';
import type { PaperDocument } from '../../core/types.ts';

export interface Doc2xSettingsResolution {
  settings: Doc2xTranslateSettings;
  /** Chinese, user facing problems that block a run. */
  errors: string[];
  /** Warnings that do not block, e.g. a website-only capability. */
  notices: string[];
  enabled: boolean;
}

function pickString(values: Record<string, unknown>, key: string, fallback: string): string {
  const raw = values[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : fallback;
}

function pickBoolean(values: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const raw = values[key];
  return typeof raw === 'boolean' ? raw : fallback;
}

function pickOne<T extends string>(
  values: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = values[key];
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

/**
 * `--ignore-translate-types` is stored as one string so the settings overlay can
 * render it with a plain text field; the CLI takes a value list.
 */
export function parseDoc2xIgnoreTranslateTypes(input: string): Doc2xIgnoreTranslateType[] {
  return input
    .split(/[\s,，、]+/)
    .map((token) => token.trim())
    .filter((token): token is Doc2xIgnoreTranslateType =>
      (doc2xIgnoreTranslateTypes as readonly string[]).includes(token),
    );
}

/**
 * Maps the plugin setting values (localStorage `aster.pluginSettings`) onto the
 * CLI settings struct. Unknown or malformed values fall back to CLI defaults so
 * a stale overlay value can never produce an invalid command line.
 */
export function readDoc2xTranslateSettings(
  values: Record<string, unknown> | undefined,
): Doc2xSettingsResolution {
  const source = values ?? {};
  const enabled = pickBoolean(source, doc2xSettingIds.enabled, true);
  const translateType: Doc2xTranslateType = pickOne(
    source,
    doc2xSettingIds.translateType,
    doc2xTranslateTypes,
    defaultDoc2xTranslateSettings.translateType,
  );
  const settings: Doc2xTranslateSettings = {
    translateType,
    targetLanguage: pickOne(
      source,
      doc2xSettingIds.targetLanguage,
      doc2xTargetLanguages,
      defaultDoc2xTranslateSettings.targetLanguage,
    ) as Doc2xTargetLanguage,
    targetModel: pickString(
      source,
      doc2xSettingIds.targetModel,
      defaultDoc2xTranslateSettings.targetModel,
    ),
    termId: pickString(source, doc2xSettingIds.termId, defaultDoc2xTranslateSettings.termId),
    pdfFontStrategy: pickOne(
      source,
      doc2xSettingIds.pdfFontStrategy,
      doc2xPdfFontStrategies,
      defaultDoc2xTranslateSettings.pdfFontStrategy,
    ) as Doc2xPdfFontStrategy,
    convertTrans: pickOne(
      source,
      doc2xSettingIds.convertTrans,
      doc2xConvertTransModes,
      defaultDoc2xTranslateSettings.convertTrans,
    ) as Doc2xConvertTrans,
    contextualTranslation: pickBoolean(
      source,
      doc2xSettingIds.contextualTranslation,
      defaultDoc2xTranslateSettings.contextualTranslation,
    ),
    ignoreTranslateTypes: parseDoc2xIgnoreTranslateTypes(
      pickString(source, doc2xSettingIds.ignoreTranslateTypes, ''),
    ),
    exportFormat: pickOne(
      source,
      doc2xSettingIds.exportFormat,
      doc2xExportFormats,
      defaultDoc2xTranslateSettings.exportFormat,
    ) as Doc2xExportFormat,
    docxTemplate: defaultDoc2xTranslateSettings.docxTemplate,
  };
  const notices: string[] = [];
  if (translateType === 'pdf' && settings.exportFormat !== 'pdf' && settings.exportFormat !== 'none') {
    notices.push('保留排版（pdf）翻译固定导出 PDF，已按 PDF 处理。');
  }
  if (settings.exportFormat === 'docx') {
    notices.push('docx 导出仅 V3 模型支持，且需 Doc2X 订阅。');
  }
  notices.push('官网的保留排版 Word/WPS、MathType、Typst、表格 Excel 与图片翻译编辑画布暂无 CLI 参数，暂不支持。');
  return { settings, errors: validateDoc2xTranslateSettings(settings), notices, enabled };
}

/** Absolute path of the paper's primary PDF; relative names live under the files root. */
export function resolveDoc2xSourcePath(paper: PaperDocument, filesRoot: string): string {
  const raw = paper.sourcePdf.trim();
  if (!raw) return '';
  const absolute = /^([a-zA-Z]:)?[\\/]/.test(raw);
  if (absolute) return raw.replace(/\\/g, '/');
  const root = filesRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${root}/${raw.replace(/^\/+/, '')}`;
}

export interface Doc2xRunPaths {
  /** `translations/<paperId>/<runId>` under the library files root. */
  out: string;
  receiptPath: string;
  runId: string;
}

/**
 * Every run writes to its own directory so a repeated translation never
 * overwrites an earlier result; the translated file is then bound back to the
 * same paper instead of creating a second library entry.
 */
export function buildDoc2xRunPaths(filesRoot: string, paperId: string, runId: string): Doc2xRunPaths {
  const root = filesRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const out = `${root}/translations/${paperId}/${runId}`;
  return { out, receiptPath: `${out}/receipt.json`, runId };
}

export function createDoc2xRunId(now: number = Date.now()): string {
  return `run-${new Date(now).toISOString().replace(/[:.]/g, '-')}`;
}

