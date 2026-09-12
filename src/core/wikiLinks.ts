export interface WikiEntry { path: string; name: string; is_directory: boolean; extension: string; }
export interface WikiListing { entries: WikiEntry[]; truncated: boolean; }
export type WikiDirectoryReader = (path: string) => Promise<WikiListing>;
const markdownExtension = /\.(?:md|markdown|mdx)$/i;
function normalized(path: string) {
  const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:/i.test(slashed) || slashed.startsWith('//') ? slashed.toLowerCase() : slashed;
}
function parent(path: string) { return path.replace(/[\\/][^\\/]+$/, ''); }
function joined(base: string, target: string) {
  const prefix = base.replace(/\\/g, '/');
  const segments = prefix.split('/');
  for (const part of target.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') segments.pop(); else segments.push(part);
  }
  return segments.join('/');
}
function within(root: string, path: string) { const base = normalized(root); const file = normalized(path); return file === base || file.startsWith(base + '/'); }
function isMarkdown(entry: WikiEntry) { return !entry.is_directory && markdownExtension.test(entry.name); }

/** Resolve without creating files or silently choosing among same-name notes. */
export async function resolveWikiLink(root: string, from: string, rawTarget: string, list: WikiDirectoryReader): Promise<WikiEntry> {
  const target = rawTarget.trim();
  if (!target) throw new Error('双链目标为空。');
  if (!root || !within(root, from)) throw new Error('双链需要当前项目文件夹。');
  if (target.includes('#')) throw new Error('本轮支持笔记文件双链；标题或块定位尚未支持，请先打开不带 # 的笔记链接。');
  if (/^(?:[a-z][a-z\d+.-]*:|[/\\])/i.test(target) || /[\u0000-\u001f]/.test(target)) throw new Error('双链只允许项目内的笔记名称或相对路径。');
  const caseFold = /^[a-z]:/i.test(root) || root.startsWith('\\\\') || root.startsWith('//');
  const stem = (name: string) => { const value = name.replace(markdownExtension, ''); return caseFold ? value.toLowerCase() : value; };
  const cache = new Map<string, WikiListing>();
  const read = async (directory: string) => {
    const cacheKey = normalized(directory);
    if (!cache.has(cacheKey)) cache.set(cacheKey, await list(directory));
    const listing = cache.get(cacheKey)!;
    if (listing.truncated) throw new Error(`目录“${directory}”条目过多，无法可靠解析双链，请使用更具体的路径。`);
    return listing;
  };
  const choose = (matches: WikiEntry[]) => {
    if (matches.length > 1) throw new Error(`找到多篇同名笔记，请使用相对路径：\n${matches.slice(0, 5).map((entry) => entry.path).join('\n')}`);
    return matches[0];
  };
  const explicitPath = /[/\\]/.test(target);
  for (const base of [...new Set([parent(from), root])]) {
    const candidate = joined(base, target);
    if (!within(root, candidate)) continue;
    const directory = parent(candidate);
    let listing: WikiListing;
    try { listing = await read(directory); } catch (error) {
      // Missing relative directories may still resolve relative to the vault root.
      if (explicitPath && String(error).includes('不存在')) continue;
      throw error;
    }
    const fileName = candidate.slice(candidate.lastIndexOf('/') + 1);
    const matches = listing.entries.filter((entry) => isMarkdown(entry) && (markdownExtension.test(fileName)
      ? (caseFold ? entry.name.toLowerCase() === fileName.toLowerCase() : entry.name === fileName)
      : stem(entry.name) === stem(fileName)));
    const match = choose(matches);
    if (match) return match;
  }
  if (explicitPath) throw new Error(`未找到项目内笔记“${target}”。`);
  const queue = [root]; const visited = new Set<string>(); const matches: WikiEntry[] = [];
  const ignored = new Set(['.git', 'node_modules', 'target', 'dist', '.next', '.venv', '__pycache__']);
  let fileCount = 0;
  while (queue.length) {
    if (visited.size >= 500 || fileCount >= 20000) throw new Error('项目过大，双链扫描已停止。请使用笔记的相对路径。');
    const directory = queue.shift()!; const id = normalized(directory);
    if (visited.has(id)) continue;
    visited.add(id);
    const listing = await read(directory);
    fileCount += listing.entries.length;
    for (const entry of listing.entries) {
      if (!within(root, entry.path)) continue;
      if (entry.is_directory && !ignored.has(entry.name) && !entry.name.startsWith('.')) queue.push(entry.path);
      else if (isMarkdown(entry) && stem(entry.name) === stem(target)) matches.push(entry);
    }
  }
  const match = choose(matches);
  if (!match) throw new Error(`未找到笔记“${target}”。`);
  return match;
}
