/**
 * What the title bar「打开 ▾」menu acts on (task bcabb18d).
 *
 * The menu used to act on the project root and was rendered (often disabled) on
 * every page. It now exists only while the workspace shows one concrete file,
 * and every item acts on that file. This module is the single, pure decision:
 * active tab (+ reader paper) → hidden, or a target with its menu items.
 *
 * Pure data only: no React, no Tauri. The native calls live in
 * `src/ui/openMenuActions.ts` because workbench/ must not import platform/.
 */
import { localPathFromResourceUri } from '../core/resources.ts';
import type { JsonValue } from '../core/types.ts';

export type OpenMenuFileKind = 'markdown' | 'text' | 'html' | 'pdf' | 'board' | 'image' | 'file';

/** The active tab, reduced to what the decision needs. */
export type OpenMenuSource =
  | { type: 'none' }
  /** A scene page with no file of its own: overview, library list, AI, task board… */
  | { type: 'scene'; sceneId?: string | null }
  /** A library paper open in the reader. Its PDF path belongs to the library database. */
  | { type: 'paper'; paperId: string; title?: string; sourcePdf?: string | null; sourceFileId?: string | null }
  /** A file tab (Markdown, board, HTML, image, workspace PDF, plugin resource). */
  | { type: 'resource'; tabKind: string; title?: string; path?: string | null; uri?: string | null }
  /** Agent session, terminal, diff: not a single file. */
  | { type: 'session'; tabKind: string };

/**
 * How「在文件管理器中显示」reaches the file. A paper is revealed through the
 * library (`reveal_paper_file` resolves the stored path itself), never by
 * guessing a path on the frontend.
 */
export type OpenMenuReveal =
  | { type: 'path'; path: string }
  | { type: 'paper'; paperId: string; fileId?: string };

export interface OpenMenuTarget {
  /** Changes whenever the target changes, so an open menu can close itself. */
  key: string;
  fileKind: OpenMenuFileKind;
  name: string;
  /** Full path shown (middle-elided) in the tooltip. */
  displayPath: string;
  reveal: OpenMenuReveal;
  /** The file itself, for Markdown/text/HTML only. */
  vscodePath: string | null;
  /** The folder project the file belongs to, keeping the old project-level entry reachable. */
  projectVSCodePath: string | null;
}

export type OpenMenuHiddenReason = 'no-tab' | 'scene' | 'session' | 'no-local-path' | 'paper-without-file';

export type OpenMenuResolution =
  | { visible: true; target: OpenMenuTarget }
  | { visible: false; reason: OpenMenuHiddenReason };

export interface OpenMenuOptions {
  /** Root of the active folder project, if any. */
  projectRoot?: string | null;
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);
const HTML_EXTENSIONS = new Set(['html', 'htm']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'log', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'csv', 'tsv', 'xml',
  'css', 'scss', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'h', 'cpp',
  'sh', 'ps1', 'bat', 'tex', 'bib', 'sql', 'r', 'rb', 'lua',
]);
const VSCODE_KINDS = new Set<OpenMenuFileKind>(['markdown', 'text', 'html']);

function extensionOf(path: string) {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function baseName(path: string) {
  const trimmed = path.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

export function openMenuFileKind(path: string): OpenMenuFileKind {
  const extension = extensionOf(path);
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown';
  if (HTML_EXTENSIONS.has(extension)) return 'html';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'a4board') return 'board';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  return 'file';
}

/** `C:\…`, `C:/…`, `\\server\share\…` or `/…`. Relative names are not revealable. */
export function isAbsoluteLocalPath(path: string) {
  return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]/.test(path) || path.startsWith('/');
}

function normalizedForCompare(path: string) {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Whether `path` lies inside `root` (Windows paths compare case-insensitively). */
export function isInsideFolder(path: string, root: string) {
  const file = normalizedForCompare(path);
  const folder = normalizedForCompare(root);
  return Boolean(folder) && file.startsWith(folder + '/');
}

/** Columns a string occupies in the UI font: CJK and other wide characters count 2. */
function charWidth(char: string) {
  return (char.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1;
}

export function displayWidth(text: string) {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width;
}

/**
 * Keeps the drive/first folders and the file name, eliding the middle:
 * `D:\WorkSpace\…\notes\读书笔记.md`. Measured in display columns (CJK = 2)
 * so Chinese paths are cut at the same visual width as ASCII ones.
 */
export function middleEllipsisPath(path: string, max = 72) {
  if (displayWidth(path) <= max) return path;
  const chars = [...path];
  const budget = max - 1; // one column for the ellipsis
  const tailBudget = Math.max(Math.ceil(budget * 0.6), Math.min(displayWidth(baseName(path)), budget - 8));
  let tail = '';
  let used = 0;
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const width = charWidth(chars[index]);
    if (used + width > tailBudget) break;
    tail = chars[index] + tail;
    used += width;
  }
  const headBudget = budget - used;
  let head = '';
  used = 0;
  for (const char of chars) {
    const width = charWidth(char);
    if (used + width > headBudget) break;
    head += char;
    used += width;
  }
  return `${head}…${tail}`;
}

function resourcePath(source: Extract<OpenMenuSource, { type: 'resource' }>) {
  const direct = source.path?.trim();
  if (direct && isAbsoluteLocalPath(direct)) return direct;
  const uri = source.uri?.trim();
  if (uri) {
    const local = localPathFromResourceUri(uri);
    if (local && isAbsoluteLocalPath(local)) return local;
    if (isAbsoluteLocalPath(uri)) return uri;
  }
  return null;
}

export function resolveOpenMenuTarget(source: OpenMenuSource, options: OpenMenuOptions = {}): OpenMenuResolution {
  if (source.type === 'none') return { visible: false, reason: 'no-tab' };
  if (source.type === 'scene') return { visible: false, reason: 'scene' };
  if (source.type === 'session') return { visible: false, reason: 'session' };

  if (source.type === 'paper') {
    const stored = source.sourcePdf?.trim() ?? '';
    const fileId = source.sourceFileId?.trim() ?? '';
    if (!stored && !fileId) return { visible: false, reason: 'paper-without-file' };
    const name = stored ? baseName(stored) : (source.title?.trim() || 'PDF');
    return {
      visible: true,
      target: {
        key: `paper:${source.paperId}:${fileId || stored}`,
        fileKind: 'pdf',
        name,
        displayPath: stored || name,
        reveal: { type: 'paper', paperId: source.paperId, ...(fileId ? { fileId } : {}) },
        vscodePath: null,
        projectVSCodePath: null,
      },
    };
  }

  const path = resourcePath(source);
  if (!path) return { visible: false, reason: 'no-local-path' };
  const fileKind = openMenuFileKind(path);
  const projectRoot = options.projectRoot?.trim() || null;
  return {
    visible: true,
    target: {
      key: `path:${path}`,
      fileKind,
      name: baseName(path),
      displayPath: path,
      reveal: { type: 'path', path },
      vscodePath: VSCODE_KINDS.has(fileKind) ? path : null,
      projectVSCodePath: projectRoot && isInsideFolder(path, projectRoot) ? projectRoot : null,
    },
  };
}

/** Minimal tab shape (a structural subset of `WorkspaceTab`). */
export interface OpenMenuTabLike {
  kind: string;
  title?: string;
  state?: Record<string, JsonValue>;
}

export interface OpenMenuReaderPaper {
  paperId: string;
  title?: string;
  sourcePdf?: string | null;
  sourceFileId?: string | null;
}

const SESSION_TAB_KINDS = new Set(['agent', 'terminal', 'diff']);

function stateString(tab: OpenMenuTabLike, key: string) {
  const value = tab.state?.[key];
  return typeof value === 'string' ? value : null;
}

/**
 * Maps the tab the host is showing to a source. `readerPaperId` is the paper a
 * reader tab is bound to (the caller owns the reader tab-key format).
 */
export function openMenuSourceFromTab(
  tab: OpenMenuTabLike | null | undefined,
  reader: { paperId: string | null; paper?: OpenMenuReaderPaper | null } = { paperId: null },
): OpenMenuSource {
  if (!tab) return { type: 'none' };
  if (tab.kind === 'tool') {
    if (!reader.paperId) return { type: 'scene' };
    const paper = reader.paper;
    return {
      type: 'paper',
      paperId: reader.paperId,
      title: paper?.title ?? tab.title,
      sourcePdf: paper?.sourcePdf ?? '',
      sourceFileId: paper?.sourceFileId ?? '',
    };
  }
  if (SESSION_TAB_KINDS.has(tab.kind)) return { type: 'session', tabKind: tab.kind };
  return { type: 'resource', tabKind: tab.kind, title: tab.title, path: stateString(tab, 'path'), uri: stateString(tab, 'uri') };
}
