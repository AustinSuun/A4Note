import { forwardRef, useImperativeHandle, useRef } from 'react';
import { MarkdownLivePreviewEditor, type MarkdownLivePreviewEditorHandle } from '../explorer/MarkdownLivePreviewEditor';

export type MarkdownLiveEditorHandle = {
  pickImages: () => void;
  setMarkdown: (markdown: string) => void;
  focus: () => void;
  hasSelection: () => boolean;
  getSelection: () => { source: string; from: number; to: number; text: string } | null;
  insertMarkdown: (before: string, after?: string, placeholder?: string) => void;
  insertTemplate: (source: string, block: boolean) => void;
  clearFormatting: () => void;
};

/** Reader notes use the same CodeMirror Markdown surface as standalone files. */
export const MarkdownLiveEditor = forwardRef<MarkdownLiveEditorHandle, {
  markdown: string;
  placeholder: string;
  sourceMode?: boolean;
  documentPath?: string;
  imageUpload?: (file: File) => Promise<string>;
  onChange: (markdown: string) => void;
  onBlur: () => void;
}>(function MarkdownLiveEditor({ markdown, placeholder, sourceMode = false, documentPath, imageUpload, onChange, onBlur }, forwardedRef) {
  const editorRef = useRef<MarkdownLivePreviewEditorHandle | null>(null);

  useImperativeHandle(forwardedRef, () => ({
    pickImages: () => editorRef.current?.pickImages(),
    setMarkdown: (nextMarkdown) => editorRef.current?.setMarkdown(nextMarkdown),
    focus: () => editorRef.current?.focus(),
    hasSelection: () => editorRef.current?.hasSelection() ?? false,
    getSelection: () => editorRef.current?.getSelection() ?? null,
    insertMarkdown: (before, after, placeholderText) => editorRef.current?.insertMarkdown(before, after, placeholderText),
    insertTemplate: (source, block) => editorRef.current?.insertTemplate(source, block),
    clearFormatting: () => editorRef.current?.clearFormatting(),
  }), []);

  return (
    <MarkdownLivePreviewEditor
      ref={editorRef}
      documentPath={documentPath}
      imageUpload={imageUpload}
      markdown={markdown}
      placeholder={placeholder}
      sourceMode={sourceMode}
      onChange={onChange}
      onBlur={onBlur}
    />
  );
});
