import { replaceMarkdownTitle, splitFrontmatter, titleFromBody } from './markdownDocument.ts';
import type { TextDocumentSession } from './textDocumentSession.ts';

export interface MarkdownTitleFile { path: string; name: string }
export function markdownFileStem(name: string) { return name.replace(/\.(?:md|markdown|mdx)$/i, ''); }
const committing = new WeakSet<TextDocumentSession>();

/** A title is an editing draft until commit. Empty commits never mutate the file. */
export async function commitMarkdownTitle(options: {
  session: TextDocumentSession;
  file: MarkdownTitleFile;
  original: string;
  draft: string;
  rename?: (path: string, stem: string) => Promise<MarkdownTitleFile>;
  onRenamed?: (file: MarkdownTitleFile) => void;
}) {
  const { session, file, original, rename, onRenamed } = options;
  const next = options.draft.trim();
  if (!next || next === original) return;
  if (committing.has(session)) throw new Error('标题正在保存，请稍后再改名。');
  if (session.getSnapshot().path !== file.path) throw new Error('文件路径已改变，请重新打开后改名。');
  const current = titleFromBody(splitFrontmatter(session.getSnapshot().content).body) || markdownFileStem(file.name);
  if (current !== original) throw new Error('标题已在其他视图发生变化，请核对后重试。');
  if (/[\r\n]/.test(next)) throw new Error('标题不能包含换行。');
  if (rename && (/[<>:"/\\|?*\u0000-\u001f]/.test(next) || /^\.|\.$/.test(next))) {
    throw new Error('标题包含文件名不支持的字符，未修改文件。');
  }
  committing.add(session);
  try {
    // The existing path mutation API drains/pauses the shared save session,
    // rejects collisions and migrates its path + recovery draft before returning.
    const renamed = rename && next !== markdownFileStem(file.name) ? await rename(file.path, next) : null;
    // Use the latest content: body edits made while rename was pending survive.
    session.update(replaceMarkdownTitle(session.getSnapshot().content, next));
    // Notify even if the following CAS save fails: the filesystem name DID change.
    if (renamed) onRenamed?.(renamed);
    await session.flush();
  } finally { committing.delete(session); }
}
