import { useRef, useState, type RefObject } from 'react';
import { acquireTextDocument, renameTextFile, type RenamedTextFile } from '../../platform/projects';
import { commitMarkdownTitle } from '../../core/markdownTitleEdit';

export function MarkdownDocumentTitle({ path, name, title, inputRef, onRenamed, onError }: {
  path: string; name: string; title: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onRenamed?: (file: RenamedTextFile) => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const edit = useRef<{ original: string; value: string } | null>(null);
  const pending = useRef(false);
  const commit = async () => {
    const change = edit.current;
    if (!change || pending.current) return;
    edit.current = null;
    if (!change.value.trim() || change.value.trim() === change.original) { setDraft(null); return; }
    pending.current = true; setBusy(true); onError('');
    try {
      const session = await acquireTextDocument(path);
      await commitMarkdownTitle({ session, file: { path, name }, original: change.original, draft: change.value,
        // Managed summary documents have no rename callback; their fixed path is retained.
        rename: onRenamed ? renameTextFile : undefined, onRenamed });
    } catch (error) { onError(`标题提交失败：${String(error)}。请检查标题及保存状态后重试。`); }
    finally { pending.current = false; setBusy(false); setDraft(null); }
  };
  return <input ref={inputRef} className="markdown-document-title-input"
    value={draft ?? title} readOnly={busy} aria-busy={busy} aria-label="文档标题"
    onFocus={() => { if (!pending.current) { edit.current = { original: title, value: title }; setDraft(title); } }}
    onChange={(event) => {
      if (pending.current) return;
      edit.current = { original: edit.current?.original ?? title, value: event.target.value };
      setDraft(event.target.value);
    }}
    onBlur={() => { void commit(); }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); edit.current = null; setDraft(null); event.currentTarget.blur(); }
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
    }} />;
}
