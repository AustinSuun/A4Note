import './managed-image-feedback.css';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { ManagedImageInsertion } from '../../core/managedImageInsertion';

/** Shared by paste and file selection; pure text remains CodeMirror's responsibility. */
export function useManagedImagePaste(viewRef: RefObject<EditorView | null>, key: string, upload?: (file: File) => Promise<string>) {
  const context = useRef({ key, upload });
  const epoch = useRef(0);
  if (context.current.key !== key) epoch.current++;
  context.current = { key, upload };
  const picker = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => { epoch.current++; picker.current?.remove(); picker.current = null; }, []);
  const insertion = useRef(new ManagedImageInsertion<string, File>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const insert = async (files: readonly File[], text = '') => {
    if (!files.length) return;
    if (insertion.current.isPending()) { setError('正在保存上一组图片，请等待后重新粘贴。'); return; }
    const writer = context.current.upload;
    if (!writer) { setError('此文档还没有可写的托管资源位置，请先保存文档后重试。'); return; }
    const view = viewRef.current;
    if (!view || view.state.readOnly) { setError('当前文档不可编辑。'); return; }
    if (files.some(file => file.size === 0 || file.size > 3 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) {
      setError('请选择3MB以内的PNG、JPEG或WebP图片；正文未修改。'); return;
    }
    setBusy(true); setError('');
    try {
      await insertion.current.insert({
        images: [...files], text,
        current: () => {
          if (viewRef.current !== view || !view.dom.isConnected || view.state.readOnly || !context.current.upload) return null;
          const { from, to } = view.state.selection.main;
          return { scope: context.current.key, epoch: epoch.current, from, to };
        },
        write: async (_scope, file) => ({ reference: await writer(file), alt: file.name.replace(/\.[^.]+$/, '') || '粘贴图片' }),
        commit: (target, markdown) => {
          view.dispatch({ changes: { from: target.from, to: target.to, insert: markdown }, selection: { anchor: target.from + markdown.length }, userEvent: 'input.paste', annotations: isolateHistory.of('full'), scrollIntoView: true });
          view.focus();
        },
      });
    } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  };
  const insertRef = useRef(insert); insertRef.current = insert;
  const extension = useMemo(() => [
    EditorView.updateListener.of(update => { if (update.docChanged || update.selectionSet) epoch.current++; }),
    EditorView.domEventHandlers({ paste: event => {
      const data = event.clipboardData; if (!data) return false;
      const files = Array.from(data.items).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => file !== null);
      if (!files.length) return false;
      // Reject unsupported files explicitly instead of letting pasted HTML inject data URIs.
      event.preventDefault(); void insertRef.current(files, data.getData('text/plain')); return true;
    } }),
  ], []);
  const pick = () => {
    if (insertion.current.isPending()) { setError('正在保存图片，请稍后重试。'); return; }
    const view = viewRef.current, at = epoch.current, identity = context.current.key;
    if (!view) return;
    picker.current?.remove();
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.multiple = true; input.hidden = true;
    input.dataset.managedImageInput = 'true'; picker.current = input; document.body.append(input);
    const cleanup = () => { input.remove(); if (picker.current === input) picker.current = null; };
    input.addEventListener('cancel', cleanup, { once: true });
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []); cleanup();
      if (viewRef.current !== view || epoch.current !== at || context.current.key !== identity) { setError('选择图片期间文档或光标已变化，请重新选择；正文未修改。'); return; }
      void insertRef.current(files);
    }, { once: true });
    input.click();
  };
  const pickRef = useRef(pick); pickRef.current = pick;
  const feedback = (busy || error) ? <div className="markdown-image-feedback" role={error ? 'alert' : 'status'} aria-live="polite">
    <span>{error || '正在安全保存图片…'}</span>
    {!busy && <button type="button" onClick={() => setError('')} aria-label="关闭图片提示">关闭</button>}
  </div> : null;
  return { extension, pick: () => pickRef.current(), insert: (files: readonly File[]) => insertRef.current(files), feedback };
}
