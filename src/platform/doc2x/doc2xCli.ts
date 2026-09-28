/**
 * Doc2X CLI adapter — pure request building, validation and response parsing.
 *
 * This module never starts a process, never reads credential files and never
 * touches the network. Execution, streaming and UI wiring arrive in later
 * steps so the CLI contract stays testable with a fake runner.
 *
 * Capability surface verified against `@noedgeai-org/doc2x-cli` 0.2.0
 * (documented behaviour checked 2026-09-21, re-read 2026-09-28):
 * https://github.com/NoEdgeAI/doc2x-cli-skills
 *
 * Rules encoded here come from that reference, not from the Doc2X website:
 * the website exposes export modes (preserved-layout Word/WPS, MathType,
 * Typst, Excel tables, image translation canvas) that have no CLI flag, so
 * they are deliberately absent instead of being faked.
 */
export const DOC2X_COMMAND = 'doc2x';

/** The CLI needs Node.js >= 22 on the user's machine. */
export const DOC2X_MIN_NODE_MAJOR = 22;

/** CLI input limits: PDF up to 300 MB, images up to 3 MB each. */
export const DOC2X_PDF_MAX_BYTES = 300 * 1024 * 1024;
export const DOC2X_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

/** Accepted image inputs; WebP/TIFF/DOC/DOCX/PPT/PPTX are not accepted. */
export const DOC2X_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp'] as const;

export const doc2xTargetLanguages = [
  'zh',
  'en',
  'ja',
  'fr',
  'ru',
  'pt',
  'pt-BR',
  'es',
  'de',
  'ko',
  'ar',
] as const;
export type Doc2xTargetLanguage = (typeof doc2xTargetLanguages)[number];

export const doc2xTranslateTypes = ['md', 'pdf'] as const;
export type Doc2xTranslateType = (typeof doc2xTranslateTypes)[number];

export const doc2xExportFormats = ['none', 'md', 'tex', 'docx', 'html', 'pdf'] as const;
export type Doc2xExportFormat = (typeof doc2xExportFormats)[number];

export const doc2xPdfFontStrategies = ['global-consistent', 'page-optimal'] as const;
export type Doc2xPdfFontStrategy = (typeof doc2xPdfFontStrategies)[number];

export const doc2xConvertTransModes = ['both', 'origin', 'translate'] as const;
export type Doc2xConvertTrans = (typeof doc2xConvertTransModes)[number];

export const doc2xIgnoreTranslateTypes = ['table', 'code', 'figure', 'reference'] as const;
export type Doc2xIgnoreTranslateType = (typeof doc2xIgnoreTranslateTypes)[number];

export const doc2xDocxTemplates = [
  'default',
  'general',
  'academic',
  'business',
  'elegant',
  'minimal',
  'technical',
] as const;
export type Doc2xDocxTemplate = (typeof doc2xDocxTemplates)[number];

/** CLI exit codes (config-and-auth reference). */
export const doc2xExitCodes = {
  success: 0,
  argument: 1,
  auth: 2,
  input: 3,
  task: 4,
  export: 5,
  batchPartial: 6,
} as const;

export interface Doc2xTranslateSettings {
  /** `pdf` keeps the source layout (original left, translation right). */
  translateType: Doc2xTranslateType;
  targetLanguage: Doc2xTargetLanguage;
  /** Model id from `doc2x models list`; the free default is `10001`. */
  targetModel: string;
  /** Glossary id; empty means “no glossary”. */
  termId: string;
  /** Only meaningful for fixed-layout PDF translation. */
  pdfFontStrategy: Doc2xPdfFontStrategy;
  /** Only meaningful for reflowed (`md`) translation. */
  convertTrans: Doc2xConvertTrans;
  contextualTranslation: boolean;
  ignoreTranslateTypes: Doc2xIgnoreTranslateType[];
  exportFormat: Doc2xExportFormat;
  docxTemplate: Doc2xDocxTemplate;
}

export interface Doc2xRunOptions {
  /** Output directory or file path passed as `--out`. */
  out: string;
  /** Where the CLI writes its JSON task receipt. */
  receiptPath: string;
}

export interface Doc2xCommandRequest {
  command: string;
  args: string[];
  /** Working directory; must exist and be absolute (Rust side enforces it). */
  cwd: string;
}

export interface Doc2xCommandResult {
  status: number;
  stdout: string;
  stderr: string;
  /** True when the Rust side killed the run at its timeout. */
  timedOut?: boolean;
}

export interface Doc2xFileDescriptor {
  path: string;
  bytes: number;
}

export interface Doc2xCliStatus {
  available: boolean;
  version: string;
  nodeMajor: number | null;
  /** Human readable blocker when `available` is false. */
  message: string;
}

export type Doc2xFailureKind =
  | 'argument'
  | 'auth'
  | 'input'
  | 'task'
  | 'export'
  | 'batch-partial'
  | 'unknown';

export interface Doc2xFailure {
  kind: Doc2xFailureKind;
  /** Chinese, user facing explanation with the next step. */
  message: string;
  retryable: boolean;
}

export interface Doc2xReceipt {
  translateId: string | null;
  status: string | null;
  outputFiles: string[];
  raw: Record<string, unknown>;
}

export const defaultDoc2xTranslateSettings: Doc2xTranslateSettings = {
  translateType: 'pdf',
  targetLanguage: 'zh',
  targetModel: '10001',
  termId: '',
  pdfFontStrategy: 'global-consistent',
  convertTrans: 'both',
  contextualTranslation: false,
  ignoreTranslateTypes: [],
  exportFormat: 'pdf',
  docxTemplate: 'default',
};

function push(args: string[], flag: string, ...values: Array<string | number | boolean | undefined>): void {
  if (values.length === 1 && values[0] === true) {
    args.push(flag);
    return;
  }
  const defined = values.filter(
    (value): value is string | number => value !== undefined && value !== false && value !== true,
  );
  if (!defined.length) return;
  args.push(flag, ...defined.map((value) => String(value)));
}

function extensionOf(path: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(path.trim());
  return match ? match[1].toLowerCase() : '';
}

/** Input rules the CLI enforces itself; checked first so the UI can explain. */
export function validateDoc2xInput(file: Doc2xFileDescriptor): string[] {
  const problems: string[] = [];
  const extension = extensionOf(file.path);
  if (!file.path.trim()) {
    problems.push('请选择要翻译的文件');
    return problems;
  }
  if (file.bytes <= 0) {
    problems.push('文件为空，无法翻译');
    return problems;
  }
  if (extension === 'pdf') {
    if (file.bytes > DOC2X_PDF_MAX_BYTES) {
      problems.push('PDF 超过 300 MB，超出 Doc2X CLI 上限');
    }
    return problems;
  }
  if ((DOC2X_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) {
    if (file.bytes > DOC2X_IMAGE_MAX_BYTES) {
      problems.push('图片超过 3 MB，超出 Doc2X CLI 上限');
    }
    return problems;
  }
  problems.push('Doc2X CLI 只接受 PDF 或 PNG/JPG/JPEG/GIF/BMP 图片；Word/PPT 需先转 PDF');
  return problems;
}

/**
 * Cross-field rules from the CLI reference. Fixed-layout PDF translation
 * always exports `.pdf`; `--convert-trans` is not passed to that export and
 * 0.1.11+ rejects `--to docx/md/html/tex` for it.
 */
export function validateDoc2xTranslateSettings(settings: Doc2xTranslateSettings): string[] {
  const problems: string[] = [];
  if (!doc2xTranslateTypes.includes(settings.translateType)) {
    problems.push('翻译模式只能是“保留排版 PDF”或“重排双语”');
  }
  if (!doc2xTargetLanguages.includes(settings.targetLanguage)) {
    problems.push(`不支持的目标语言：${settings.targetLanguage}`);
  }
  if (!settings.targetModel.trim()) {
    problems.push('请选择翻译模型（可用 doc2x models list 查看）');
  }
  if (!doc2xPdfFontStrategies.includes(settings.pdfFontStrategy)) {
    problems.push('PDF 字体策略只能是“全局一致”或“逐页最优”');
  }
  if (!doc2xConvertTransModes.includes(settings.convertTrans)) {
    problems.push('译文内容只能是“双语/仅原文/仅译文”');
  }
  if (!doc2xExportFormats.includes(settings.exportFormat)) {
    problems.push(`不支持的导出格式：${settings.exportFormat}`);
  }
  if (!doc2xDocxTemplates.includes(settings.docxTemplate)) {
    problems.push(`不支持的 Word 模板：${settings.docxTemplate}`);
  }
  for (const type of settings.ignoreTranslateTypes) {
    if (!(doc2xIgnoreTranslateTypes as readonly string[]).includes(type)) {
      problems.push(`不能忽略的内容类型：${type}`);
    }
  }
  if (settings.translateType === 'pdf') {
    if (settings.exportFormat !== 'pdf' && settings.exportFormat !== 'none') {
      problems.push('保留排版翻译只能导出 PDF（或选择不导出）');
    }
    if (settings.convertTrans !== 'both') {
      problems.push('保留排版翻译固定输出双语，不能改为仅原文或仅译文');
    }
  }
  if (settings.exportFormat === 'docx' && settings.translateType !== 'md') {
    problems.push('可编辑 Word 只能用于重排双语翻译');
  }
  return problems;
}

/**
 * `--auth-mode oauth` is always passed so the run uses the CLI login the user
 * created on this machine. Auto mode would silently fall back to the Doc2X
 * desktop account, which is not the account the user picked in our UI.
 */
function withAuthMode(args: string[]): string[] {
  return [...args, '--auth-mode', 'oauth'];
}

export function buildDoc2xTranslateRequest(
  file: Doc2xFileDescriptor,
  settings: Doc2xTranslateSettings,
  run: Doc2xRunOptions,
  cwd: string,
): Doc2xCommandRequest {
  const args = ['translate', file.path];
  push(args, '--translate-type', settings.translateType);
  push(args, '--target-language', settings.targetLanguage);
  push(args, '--target-model', settings.targetModel.trim());
  if (settings.termId.trim()) push(args, '--term-id', settings.termId.trim());
  if (settings.translateType === 'pdf') {
    push(args, '--pdf-font-strategy', settings.pdfFontStrategy);
  } else {
    push(args, '--convert-trans', settings.convertTrans);
  }
  if (settings.contextualTranslation) push(args, '--contextual-translation', true);
  if (settings.ignoreTranslateTypes.length) {
    push(args, '--ignore-translate-types', ...settings.ignoreTranslateTypes);
  }
  push(args, '--to', settings.exportFormat);
  if (settings.exportFormat === 'docx') push(args, '--docx-template', settings.docxTemplate);
  push(args, '--out', run.out);
  push(args, '--receipt', run.receiptPath);
  push(args, '--json', true);
  return { command: DOC2X_COMMAND, args: withAuthMode(args), cwd };
}

export function buildDoc2xParseRequest(
  file: Doc2xFileDescriptor,
  options: { exportFormat: Doc2xExportFormat; out: string; receiptPath: string },
  cwd: string,
): Doc2xCommandRequest {
  const args = ['parse', file.path];
  push(args, '--to', options.exportFormat);
  push(args, '--out', options.out);
  push(args, '--receipt', options.receiptPath);
  push(args, '--json', true);
  return { command: DOC2X_COMMAND, args: withAuthMode(args), cwd };
}

/**
 * `doc2x login` opens the browser on this machine and waits for the OAuth
 * callback on a random loopback port; `--no-browser` only prints the URL.
 * The CLI owns the token file, so our side must never read or copy it.
 */
export function buildDoc2xLoginRequest(cwd: string, options: { noBrowser?: boolean } = {}): Doc2xCommandRequest {
  const args = ['login'];
  if (options.noBrowser) push(args, '--no-browser', true);
  return { command: DOC2X_COMMAND, args, cwd };
}

export function buildDoc2xLogoutRequest(cwd: string): Doc2xCommandRequest {
  return { command: DOC2X_COMMAND, args: ['logout'], cwd };
}

export function buildDoc2xAccountStatusRequest(cwd: string): Doc2xCommandRequest {
  return { command: DOC2X_COMMAND, args: withAuthMode(['account', 'status', '--json']), cwd };
}

export function buildDoc2xModelsListRequest(cwd: string): Doc2xCommandRequest {
  return { command: DOC2X_COMMAND, args: withAuthMode(['models', 'list', '--json']), cwd };
}

export function buildDoc2xRecordsListRequest(
  cwd: string,
  options: { kind?: 'translate' | 'parse'; limit?: number } = {},
): Doc2xCommandRequest {
  const args = ['records', 'list'];
  push(args, '--kind', options.kind ?? 'translate');
  push(args, '--limit', options.limit ?? 20);
  push(args, '--json', true);
  return { command: DOC2X_COMMAND, args: withAuthMode(args), cwd };
}

export function buildDoc2xUsageRequest(cwd: string, translateId: string): Doc2xCommandRequest {
  const args = ['usage', 'show', translateId.trim(), '--json'];
  return { command: DOC2X_COMMAND, args: withAuthMode(args), cwd };
}

/** CLI exit codes → Chinese explanation and retry hint. Never reports success on failure. */
export function describeDoc2xFailure(status: number): Doc2xFailure | null {
  switch (status) {
    case doc2xExitCodes.success:
      return null;
    case doc2xExitCodes.argument:
      return { kind: 'argument', message: 'Doc2X 命令参数不正确，请检查翻译设置后重试', retryable: false };
    case doc2xExitCodes.auth:
      return {
        kind: 'auth',
        message: 'Doc2X 登录已失效、额度或订阅不足，请重新登录或检查账号订阅',
        retryable: false,
      };
    case doc2xExitCodes.input:
      return {
        kind: 'input',
        message: '文件无法被 Doc2X 接受（不存在、为空、过大或格式不支持）',
        retryable: false,
      };
    case doc2xExitCodes.task:
      return { kind: 'task', message: 'Doc2X 服务端处理失败，可稍后重试', retryable: true };
    case doc2xExitCodes.export:
      return { kind: 'export', message: '译文导出或下载失败，可重试', retryable: true };
    case doc2xExitCodes.batchPartial:
      return {
        kind: 'batch-partial',
        message: '批量翻译部分文件失败，请查看报告中的失败项',
        retryable: true,
      };
    default:
      return { kind: 'unknown', message: `Doc2X 命令异常退出（退出码 ${status}）`, retryable: true };
  }
}

/** Last JSON object in stdout; the CLI prints progress lines around `--json` output. */
export function parseDoc2xJsonPayload(stdout: string): Record<string, unknown> | null {
  const text = stdout.trim();
  if (!text) return null;
  const candidates: string[] = [text];
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          candidates.push(text.slice(start, index + 1));
          break;
        }
      }
    }
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // keep scanning
    }
  }
  return null;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

/** Receipt written by `--receipt`; the task id is what `usage show` needs. */
export function parseDoc2xReceipt(payload: Record<string, unknown> | null): Doc2xReceipt | null {
  if (!payload) return null;
  const nested = (payload.receipt ?? payload.task ?? payload.result) as Record<string, unknown> | undefined;
  const source = nested && typeof nested === 'object' ? { ...payload, ...nested } : payload;
  const translateId = firstString(source, ['translateId', 'translate_id', 'taskId', 'task_id', 'id']);
  const status = firstString(source, ['status', 'state']);
  const outputFiles = [
    ...stringList(source.outputFiles),
    ...stringList(source.output_files),
    ...stringList(source.files),
  ];
  return { translateId, status, outputFiles, raw: source };
}

export function parseDoc2xReceiptText(stdout: string): Doc2xReceipt | null {
  return parseDoc2xReceipt(parseDoc2xJsonPayload(stdout));
}

export function parseDoc2xVersion(stdout: string): string {
  const match = /(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(stdout);
  return match ? match[1] : '';
}

export function parseNodeMajor(versionOutput: string): number | null {
  const match = /v?(\d+)\./.exec(versionOutput.trim());
  return match ? Number(match[1]) : null;
}

/** npm package that ships the `doc2x` executable. */
export const DOC2X_CLI_PACKAGE = '@noedgeai-org/doc2x-cli';
export const DOC2X_NODE_DOWNLOAD_URL = 'https://nodejs.org/';
export const DOC2X_NPM_MIRROR_URL = 'https://registry.npmmirror.com/';

export interface Doc2xRegistryResolution {
  registry: string | null;
  error: string | null;
}

/**
 * A mirror is user supplied, so only a plain https URL is accepted:
 * anything else breaks the spawn or redirects the install elsewhere.
 */
export function normalizeDoc2xRegistry(input: string | undefined): Doc2xRegistryResolution {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return { registry: null, error: null };
  if (!/^https:\/\/\S+$/.test(trimmed)) {
    return { registry: null, error: '镜像地址必须以 https:// 开头，且不能包含空格。' };
  }
  return { registry: trimmed, error: null };
}

/** What to tell the user when `doc2x --version` did not run. */
export function describeDoc2xMissingCli(nodeMajor: number | null): string {
  if (nodeMajor === null) {
    return `未检测到 Node.js：Doc2X CLI 需要 Node.js ${DOC2X_MIN_NODE_MAJOR} 及以上，请先安装（${DOC2X_NODE_DOWNLOAD_URL}），再点「安装 Doc2X CLI」。`;
  }
  if (nodeMajor < DOC2X_MIN_NODE_MAJOR) {
    return `Node.js 版本过低（当前 v${nodeMajor}）：Doc2X CLI 需要 Node.js ${DOC2X_MIN_NODE_MAJOR} 及以上，请升级后重试。`;
  }
  return `未检测到 doc2x 命令：点「安装 Doc2X CLI」由本机安装（npm i -g ${DOC2X_CLI_PACKAGE}），或自行在终端执行该命令。`;
}