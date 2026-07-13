import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import {
  MDXEditor,
  headingsPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  thematicBreakPlugin,
  type MDXEditorMethods,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';

export type MarkdownLiveEditorHandle = {
  setMarkdown: (markdown: string) => void;
  focus: () => void;
};

export const MarkdownLiveEditor = forwardRef<MarkdownLiveEditorHandle, {
  markdown: string;
  placeholder: string;
  onChange: (markdown: string) => void;
  onBlur: () => void;
}>(function MarkdownLiveEditor({ markdown, placeholder, onChange, onBlur }, forwardedRef) {
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const lastEditorValueRef = useRef(markdown);
  const plugins = useMemo(
    () => [headingsPlugin(), listsPlugin(), quotePlugin(), thematicBreakPlugin(), linkPlugin(), markdownShortcutPlugin()],
    [],
  );

  useImperativeHandle(forwardedRef, () => ({
    setMarkdown(nextMarkdown) {
      lastEditorValueRef.current = nextMarkdown;
      editorRef.current?.setMarkdown(nextMarkdown);
    },
    focus() {
      editorRef.current?.focus();
    },
  }), []);

  useEffect(() => {
    if (markdown === lastEditorValueRef.current) return;
    lastEditorValueRef.current = markdown;
    editorRef.current?.setMarkdown(markdown);
  }, [markdown]);

  return (
    <MDXEditor
      ref={editorRef}
      className="note-live-editor"
      contentEditableClassName="note-live-editor-content"
      markdown={markdown}
      placeholder={placeholder}
      plugins={plugins}
      onChange={(nextMarkdown) => {
        lastEditorValueRef.current = nextMarkdown;
        onChange(nextMarkdown);
      }}
      onBlur={onBlur}
      spellCheck
    />
  );
});
