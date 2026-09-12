import { forwardRef, useImperativeHandle, useRef } from 'react';
import { MarkdownLivePreviewEditor, type MarkdownLivePreviewEditorHandle } from '../explorer/MarkdownLivePreviewEditor';

export type MarkdownLiveEditorHandle = {
  setMarkdown: (markdown: string) => void;
  focus: () => void;
  insertMarkdown: (markdown: string) => void;
};

/** Reader notes use the same CodeMirror Markdown surface as standalone files. */
export const MarkdownLiveEditor = forwardRef<MarkdownLiveEditorHandle, {
  markdown: string;
  placeholder: string;
  onChange: (markdown: string) => void;
  onBlur: () => void;
}>(function MarkdownLiveEditor({ markdown, placeholder, onChange, onBlur }, forwardedRef) {
  const editorRef = useRef<MarkdownLivePreviewEditorHandle | null>(null);

  useImperativeHandle(forwardedRef, () => ({
    setMarkdown: (nextMarkdown) => editorRef.current?.setMarkdown(nextMarkdown),
    focus: () => editorRef.current?.focus(),
    insertMarkdown: (nextMarkdown) => editorRef.current?.insertMarkdown(nextMarkdown),
  }), [onChange]);

  return (
    <MarkdownLivePreviewEditor
      ref={editorRef}
      markdown={markdown}
      placeholder={placeholder}
      onChange={onChange}
      onBlur={onBlur}
    />
  );
});
