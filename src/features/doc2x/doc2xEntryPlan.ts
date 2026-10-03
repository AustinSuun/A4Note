/**
 * Doc2X library entry messages (doc2x-entry-arena).
 *
 * Tauri-free on purpose, like `doc2xOutcome.ts`: the entry guidance and the
 * failure → next-step mapping are plain data, so they can be verified in Node
 * without a running app.
 */

export const DOC2X_ENTRY_INSTALL_HINT = 'npm i -g @noedgeai-org/doc2x-cli';
export const DOC2X_ENTRY_LOGIN_HINT = 'doc2x login';
export const DOC2X_ENTRY_MIN_NODE_MAJOR = 22;

/** One-time discoverability hint; cleared by the user, never shown twice. */
export const DOC2X_ENTRY_HINT_STORAGE_KEY = 'aster.doc2xEntryHintSeen';

export function doc2xEntryFirstRunHint(): string {
  return 'Doc2X 翻译：在文献右键菜单或详情面板点「Doc2X 翻译」，用你自己的账号在本机翻译，译文回到同一篇文献。本提示只显示一次。';
}

export function describeDoc2xEntryDisabled(): string {
  return '已在设置中关闭「启用 Doc2X 翻译入口」。请到设置 → Doc2X 打开后再试。';
}

export interface Doc2xEntryCliState {
  available: boolean;
  version?: string;
  nodeMajor: number | null;
  message?: string;
}

/** Highest-priority blocker first: Node major, then a missing CLI. */
export function describeDoc2xEntryCli(state: Doc2xEntryCliState): string {
  if (state.nodeMajor !== null && state.nodeMajor < DOC2X_ENTRY_MIN_NODE_MAJOR) {
    return `Doc2X CLI 需要 Node.js ${DOC2X_ENTRY_MIN_NODE_MAJOR} 及以上，当前检测到 v${state.nodeMajor}。请先升级 Node.js，再执行 ${DOC2X_ENTRY_INSTALL_HINT}。`;
  }
  if (!state.available) {
    return `未检测到 Doc2X CLI（本机命令 doc2x）。安装：${DOC2X_ENTRY_INSTALL_HINT}（需要 Node.js ${DOC2X_ENTRY_MIN_NODE_MAJOR}+），装好后运行 ${DOC2X_ENTRY_LOGIN_HINT} 登录你自己的账号。软件不会代你安装或代你登录。`;
  }
  return state.version ? `已检测到 Doc2X CLI ${state.version}。` : '已检测到 Doc2X CLI。';
}

export function describeDoc2xEntryMissingPdf(title: string): string {
  return `《${title}》没有主 PDF，无法翻译。请先导入 PDF 或补全该文献的文件后再试。`;
}

export type Doc2xEntryFailureKind =
  | 'argument'
  | 'auth'
  | 'input'
  | 'task'
  | 'export'
  | 'batch-partial'
  | 'unknown';

export interface Doc2xEntryFailure {
  kind: Doc2xEntryFailureKind;
  message: string;
  retryable?: boolean;
}

/**
 * The CLI only reports an exit code, so the entry adds the "what do I do now"
 * half: an auth/quota failure points at the login entry instead of leaving the
 * user with a dead end.
 */
export function describeDoc2xEntryFailure(failure: Doc2xEntryFailure): string {
  switch (failure.kind) {
    case 'auth':
      return `${failure.message}。若尚未登录或登录已过期：在本机运行 ${DOC2X_ENTRY_LOGIN_HINT}，或打开 Doc2X 面板点「登录自有账号」；额度或订阅不足请点「查询额度/订阅」查看。`;
    case 'input':
      return `${failure.message}；请确认该文献的主 PDF 存在、可读且不超过 CLI 的大小限制。`;
    case 'argument':
      return `${failure.message}；请检查设置里的 Doc2X 翻译模式与导出格式是否与 CLI 版本匹配。`;
    case 'batch-partial':
      return `${failure.message}；批量翻译请看面板列表，仅重试失败项。`;
    default:
      return failure.retryable === false ? failure.message : `${failure.message}（可重试）`;
  }
}

export function describeDoc2xEntryTimeout(): string {
  return 'Doc2X 翻译超时（CLI 默认 15 分钟）。请重试，或打开 Doc2X 面板查看 CLI 输出。';
}

export function describeDoc2xEntryNoOutput(): string {
  return 'Doc2X 未报告译文文件。请打开 Doc2X 面板查看 CLI 输出，并确认账号额度与所选翻译模型。';
}

export function describeDoc2xEntrySuccess(path: string): string {
  return `译文已回到该文献：${path}`;
}

/** Single paper keeps its own message; batches stay honest about partial failure. */
export function summarizeDoc2xEntryBatch(messages: string[], successes: number): string {
  if (!messages.length) return '没有可翻译的文献。';
  if (messages.length === 1) return messages[0];
  const failed = messages.length - successes;
  if (failed === 0) return `已完成 ${successes} 篇翻译，译文已回到各自文献。`;
  const firstFailure = messages.find((message) => !message.startsWith('译文已回到该文献')) ?? '';
  return `批量翻译结束：成功 ${successes} 篇，失败 ${failed} 篇。首个失败原因：${firstFailure}`;
}
