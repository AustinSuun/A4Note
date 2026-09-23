import { forwardRef, useImperativeHandle, useRef } from 'react';
import { MarkdownLivePreviewEditor, type MarkdownLivePreviewEditorHandle } from '../explorer/MarkdownLivePreviewEditor';

export type MarkdownLiveEditorHandle = {
  setMarkdown: (markdown: string) => void;
  focus: () => void;
  hasSelection: () => boolean;
  insertMarkdown: (before: string, after?: string, placeholder?: string) => void;
  insertTemplate: (source: string, block: boolean) => void;
  clearFormatting: () => void;
};

/** Reader notes use the same CodeMirror Markdown surface as standalone files. */
export const MarkdownLiveEditor = forwardRef<MarkdownLiveEditorHandle, {
  markdown: string;
  placeholder: string;
  sourceMode?: boolean;
  onChange: (markdown: string) => void;
  onBlur: () => void;
}>(function MarkdownLiveEditor({ markdown, placeholder, sourceMode = false, onChange, onBlur }, forwardedRef) {
  const editorRef = useRef<MarkdownLivePreviewEditorHandle | null>(null);

  useImperativeHandle(forwardedRef, () => ({
    setMarkdown: (nextMarkdown) => editorRef.current?.setMarkdown(nextMarkdown),
    focus: () => editorRef.current?.focus(),
    hasSelection: () => editorRef.current?.hasSelection() ?? false,
    insertMarkdown: (before, after, placeholderText) => editorRef.current?.insertMarkdown(before, after, placeholderText),
    insertTemplate: (source, block) => editorRef.current?.insertTemplate(source, block),
    clearFormatting: () => editorRef.current?.clearFormatting(),
  }), []);

  return (
    <MarkdownLivePreviewEditor
      ref={editorRef}
      markdown={markdown}
      placeholder={placeholder}
      sourceMode={sourceMode}
      onChange={onChange}
      onBlur={onBlur}
    />
  );
});
