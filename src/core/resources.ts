/**
 * Resource identity: one stable record for anything a tab can point at.
 *
 * Pure string and data helpers only — no React, no Tauri, no storage. A
 * `Resource` is what lets a tab, an annotation or an AI context refer to the
 * same file without first agreeing on how to spell its path.
 */
import type { JsonValue } from './types';

export type ResourceKind = 'file' | 'folder' | 'pdf' | 'markdown' | 'image' | 'web' | `plugin:${string}`;

/**
 * `uri` is always the output of `normalizeResourceUri`; `resourceKey(uri)` is the
 * dedup identity. `projectId` scopes the record to one project and makes it
 * disappear with that project; no `projectId` means the resource is global.
 */
export interface Resource {
  id: string;
  projectId?: string;
  kind: ResourceKind;
  uri: string;
  title: string;
  metadata: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
}

export const RESOURCE_KINDS: ResourceKind[] = ['file', 'folder', 'pdf', 'markdown', 'image', 'web'];
export const RESOURCE_TAB_KEY_PREFIX = 'resource:';

/** RFC 3986 pchar plus `/`: everything else inside a path gets percent-encoded. */
const PATH_ESCAPE = /[^A-Za-z0-9\-._~!$&'()*+,;=:@/]+/gu;
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const WINDOWS_DRIVE = /^[A-Za-z]:([\\/]|$)/;
const DEFAULT_PORTS: Record<string, string> = { http: '80', https: '443' };
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico', 'tif', 'tiff'];
const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdx'];

export function isResourceKind(value: string): value is ResourceKind {
  return RESOURCE_KINDS.includes(value as ResourceKind) || value.startsWith('plugin:');
}

/** `null` for a bare path. `D:\x` is a Windows path, not a `d:` scheme. */
export function resourceUriScheme(uri: string) {
  const trimmed = uri.trim();
  if (WINDOWS_DRIVE.test(trimmed)) return null;
  const match = SCHEME.exec(trimmed);
  return match ? match[1].toLowerCase() : null;
}

/** Iterates code points, so a surrogate pair survives and a lone one is dropped instead of throwing. */
function encodeUriPath(path: string) {
  return path.replace(PATH_ESCAPE, (chunk) => {
    let encoded = '';
    for (const char of chunk) {
      try {
        encoded += encodeURIComponent(char);
      } catch {
        // A lone surrogate has no UTF-8 encoding; dropping it beats throwing.
      }
    }
    return encoded;
  });
}

function decodeUriPath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * Collapses repeated and trailing slashes and upper-cases the drive letter, so
 * `d:\a\\b\` and `D:/a/b` end up as one path. `..` is left alone on purpose:
 * resolving it is a filesystem question, not a string one.
 */
function canonicalFilePath(path: string) {
  const collapsed = `/${path.split('/').filter(Boolean).join('/')}`;
  return collapsed.replace(/^\/([A-Za-z]):/, (_match, letter: string) => `/${letter.toUpperCase()}:`);
}

function fileUriFromPath(path: string) {
  const slashed = path.replace(/\\/g, '/');
  if (slashed.startsWith('//')) {
    const [host = '', ...segments] = slashed.replace(/^\/+/, '').split('/');
    const tail = canonicalFilePath(segments.join('/'));
    return `file://${host.toLowerCase()}${tail === '/' ? '' : encodeUriPath(tail)}`;
  }
  return `file://${encodeUriPath(canonicalFilePath(slashed))}`;
}

/** `rest` is everything after `file:` — `///D:/x`, `//server/share/x` or `/D:/x`. */
function normalizeFileUri(rest: string) {
  if (!rest.startsWith('//')) return `file://${encodeUriPath(canonicalFilePath(decodeUriPath(rest)))}`;
  const body = rest.slice(2);
  const slash = body.indexOf('/');
  const host = (slash === -1 ? body : body.slice(0, slash)).toLowerCase();
  const path = canonicalFilePath(decodeUriPath(slash === -1 ? '' : body.slice(slash)));
  if (!host) return `file://${encodeUriPath(path)}`;
  return `file://${host}${path === '/' ? '' : encodeUriPath(path)}`;
}

/** Case-folds scheme and host, drops the default port and a bare trailing slash; leaves path case and escapes alone. */
function normalizeWebUri(scheme: string, rest: string) {
  const body = rest.replace(/^\/+/, '');
  const cut = body.search(/[/?#]/);
  const authority = cut === -1 ? body : body.slice(0, cut);
  const tail = cut === -1 ? '' : body.slice(cut);
  const at = authority.lastIndexOf('@');
  const userInfo = at === -1 ? '' : `${authority.slice(0, at)}@`;
  const hostPort = at === -1 ? authority : authority.slice(at + 1);
  // Split the port only past the last `]`, so `[::1]:8080` keeps its IPv6 host.
  const colon = hostPort.lastIndexOf(':');
  const hasPort = colon > hostPort.lastIndexOf(']');
  const host = (hasPort ? hostPort.slice(0, colon) : hostPort).toLowerCase();
  const rawPort = hasPort ? hostPort.slice(colon + 1) : '';
  const port = rawPort && rawPort !== DEFAULT_PORTS[scheme] ? `:${rawPort}` : '';
  const hash = tail.indexOf('#');
  const fragment = hash === -1 ? '' : tail.slice(hash + 1);
  const beforeHash = hash === -1 ? tail : tail.slice(0, hash);
  const question = beforeHash.indexOf('?');
  const query = question === -1 ? '' : beforeHash.slice(question + 1);
  const path = (question === -1 ? beforeHash : beforeHash.slice(0, question)).replace(/\/+$/, '');
  return `${scheme}://${userInfo}${host}${port}${path}${query ? `?${query}` : ''}${fragment ? `#${fragment}` : ''}`;
}

/**
 * Windows path, UNC path, POSIX path or URI in; one canonical URI out. Running it
 * on its own output changes nothing, which is what makes `resourceKey` a usable
 * identity. An empty input stays empty — callers decide whether that is an error.
 */
export function normalizeResourceUri(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  if (WINDOWS_DRIVE.test(raw) || raw.startsWith('\\') || raw.startsWith('/')) return fileUriFromPath(raw);
  const scheme = resourceUriScheme(raw);
  if (!scheme) return fileUriFromPath(raw);
  const rest = raw.slice(raw.indexOf(':') + 1);
  if (scheme === 'file') return normalizeFileUri(rest);
  if (scheme === 'http' || scheme === 'https') return normalizeWebUri(scheme, rest);
  // Anything else (`aster://library`, `plugin://…`) keeps its shape: only the
  // scheme is case-folded, because we do not know that opaque tail's rules.
  return `${scheme}:${rest.replace(/\/+$/, '')}`;
}

/** The reverse trip, for the native layer. `null` for anything that is not a `file:` URI. */
export function localPathFromResourceUri(uri: string): string | null {
  const normalized = normalizeResourceUri(uri);
  if (resourceUriScheme(normalized) !== 'file') return null;
  const rest = normalized.slice('file:'.length);
  if (!rest.startsWith('//')) return null;
  const body = rest.slice(2);
  const slash = body.indexOf('/');
  const host = slash === -1 ? body : body.slice(0, slash);
  const path = decodeUriPath(slash === -1 ? '' : body.slice(slash));
  if (host) return `\\\\${host}${path.replace(/\//g, '\\')}`;
  if (/^\/[A-Za-z]:/.test(path)) return path.slice(1).replace(/\//g, '\\');
  return path;
}

/** Lower-case file extension without the leading dot. */
export function resourceUriExtension(uri: string) {
  const path = uri.split(/[?#]/)[0] ?? '';
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export interface ResourceOpenerMatcher {
  id: string;
  kind: string;
  priority?: number;
  pluginId?: string;
  sceneId?: string;
  extensions?: string[];
  schemes?: string[];
}

export interface ResourceOpenerResolutionInput<T extends ResourceOpenerMatcher = ResourceOpenerMatcher> {
  uri: string;
  resourceKind?: string;
  openers: readonly T[];
  scenes?: readonly { id: string; pluginId?: string }[];
  isPluginActive?: (pluginId: string) => boolean;
}

/** Whether one opener can handle this URI/kind. Matching is declarative and side-effect free. */
export function resourceOpenerMatches(opener: ResourceOpenerMatcher, uri: string, resourceKind?: string) {
  const normalized = normalizeResourceUri(uri);
  const extension = resourceUriExtension(normalized);
  const scheme = resourceUriScheme(normalized);
  const requestedKind = resourceKind ?? inferResourceKind(uri);
  // Resource records prefix plugin-owned kinds so they remain distinguishable
  // from host kinds. Accept both spellings at the routing boundary.
  const kindMatch = opener.kind === requestedKind || `plugin:${opener.kind}` === requestedKind;
  const extensionMatch = Boolean(extension && opener.extensions?.some((candidate) => candidate.replace(/^\./, '').toLowerCase() === extension));
  const schemeMatch = Boolean(scheme && opener.schemes?.some((candidate) => candidate.replace(/:$/, '').toLowerCase() === scheme));
  return kindMatch || extensionMatch || schemeMatch;
}

/**
 * Resolve one active opener. Higher priority wins; id is the stable tie-breaker
 * so a plugin cannot make routing nondeterministic by registration order.
 */
export function resolveResourceOpener<T extends ResourceOpenerMatcher = ResourceOpenerMatcher>(input: ResourceOpenerResolutionInput<T>) {
  const scenes = input.scenes ?? [];
  const isPluginActive = input.isPluginActive ?? (() => true);
  return input.openers
    .filter((opener) => resourceOpenerMatches(opener, input.uri, input.resourceKind ?? inferResourceKind(input.uri)))
    .filter((opener) => !opener.pluginId || isPluginActive(opener.pluginId))
    .filter((opener) => {
      if (!opener.sceneId) return true;
      const scene = scenes.find((candidate) => candidate.id === opener.sceneId);
      return Boolean(scene && (!scene.pluginId || isPluginActive(scene.pluginId)));
    })
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id))[0];
}

/**
 * Extension first, scheme second. `folder` is never inferred — normalization
 * strips the trailing slash that would hint at one, and the caller (file tree,
 * importer) already knows; guessing wrong would send a directory to a text
 * viewer. Pass `fallback: 'folder'` when you do know.
 */
export function inferResourceKind(uri: string, fallback: ResourceKind = 'file'): ResourceKind {
  const normalized = normalizeResourceUri(uri);
  if (!normalized) return fallback;
  const extension = resourceUriExtension(normalized);
  if (extension === 'pdf') return 'pdf';
  if (MARKDOWN_EXTENSIONS.includes(extension)) return 'markdown';
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  const scheme = resourceUriScheme(normalized);
  if (scheme === 'http' || scheme === 'https') return 'web';
  return fallback;
}

/** Last path segment, decoded. Falls back to the host for a bare web origin. */
export function resourceTitleFromUri(uri: string) {
  const normalized = normalizeResourceUri(uri);
  if (!normalized) return '';
  const local = localPathFromResourceUri(normalized);
  const source = local ?? (normalized.split(/[?#]/)[0] ?? normalized);
  const segments = source.replace(/\\/g, '/').split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  return last ? decodeUriPath(last) : normalized;
}

/**
 * Dedup identity. Windows paths and our own `aster://` URIs are case-insensitive;
 * a web path is not, so only its scheme and host were folded during normalization.
 */
export function resourceKey(uri: string) {
  const normalized = normalizeResourceUri(uri);
  const scheme = resourceUriScheme(normalized);
  return scheme === 'file' || scheme === 'aster' ? normalized.toLowerCase() : normalized;
}

export function sameResourceUri(left: string, right: string) {
  return resourceKey(left) === resourceKey(right);
}

/** Tab key for a resource-backed tab, so two spellings of one path cannot open two tabs. */
export function resourceTabKey(uri: string) {
  return `${RESOURCE_TAB_KEY_PREFIX}${resourceKey(uri)}`;
}
