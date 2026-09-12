import { useEffect, useRef, useId, type FormEvent } from 'react';
import { Folder, Check, X } from 'lucide-react';
export type FolderCreation = { parentId: string; name: string; error: string; saving: boolean; onNameChange(name: string): void; onSubmit(event: FormEvent<HTMLFormElement>): void | Promise<void>; onCancel(): void };
export function FolderDraftRow({ depth, parentName, creation }: { depth: number; parentName: string; creation: FolderCreation }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const descriptionId = useId();
  useEffect(() => { inputRef.current?.select(); }, []);
  useEffect(() => {
    if (creation.saving) return;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [creation.saving, creation.error]);
  return (
    <form
      className="library-folder-draft"
      data-tree-row={`draft:${creation.parentId}`} data-tree-depth={depth}
      style={{ paddingLeft: `calc(${depth} * var(--file-tree-depth-step))` }}
      data-library-folder-draft-parent={creation.parentId}
      aria-label={`在${parentName}中新建文件夹`}
      aria-busy={creation.saving}
      onSubmit={(event) => {
        event.preventDefault();
        if (!composingRef.current) void creation.onSubmit(event);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        event.stopPropagation();
        // Confirming a Chinese/Japanese IME candidate must never submit/cancel.
        if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) {
          event.preventDefault();
          return;
        }
        if (event.key === 'Escape') { event.preventDefault(); creation.onCancel(); }
      }}
    >
      <div className="file-tree-row-wrap">
        <span className="library-folder-draft-spacer" aria-hidden="true" />
        <div className="file-tree-row directory library-folder-draft-row">
          <Folder size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            data-library-folder-draft-input="true"
            value={creation.name}
            disabled={creation.saving}
            aria-label="新文件夹名称"
            aria-invalid={Boolean(creation.error)}
            aria-describedby={creation.error ? `${descriptionId} ${descriptionId}-error` : descriptionId}
            placeholder="文件夹名称"
            autoComplete="off"
            onChange={(event) => creation.onNameChange(event.target.value)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
          />
        </div>
      </div>
      <div className="tree-edit-actions">
          <button type="submit" className="tree-edit-confirm" disabled={creation.saving || !creation.name.trim()} aria-label="确认创建文件夹" title="创建（Enter）"><Check size={17} aria-hidden="true" /><span>创建</span></button>
          <button type="button" className="tree-edit-cancel" disabled={creation.saving} onClick={creation.onCancel} aria-label="取消创建文件夹" title="取消（Esc）"><X size={17} aria-hidden="true" /><span>取消</span></button>
      </div>
      <span id={descriptionId} className="library-folder-draft-help">Enter 创建，Esc 取消</span>
      {creation.saving && <span className="library-folder-draft-message" role="status">正在创建…</span>}
      {creation.error && <span id={`${descriptionId}-error`} className="library-folder-draft-message error" role="alert">{creation.error}</span>}
    </form>
  );
}
