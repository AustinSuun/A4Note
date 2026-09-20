import { useLayoutEffect, useRef, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { normalizeInlineText } from './pdfTextAnnotation';

/**
 * In-page editor for text annotations. A plaintext contenteditable box sizes itself
 * from its content, so growth, wrapping and shrinking are native layout instead of
 * measurement code, and IME composition behaves like any text field.
 *
 * Finishing rules (documented for task 540986ab):
 * - Escape, Ctrl/Cmd+Enter, clicking outside (blur) or moving focus elsewhere finish editing and keep the text.
 * - Enter inserts a line break. Keys are never forwarded to reader shortcuts while editing.
 * - Escape pressed while an IME composition is open only cancels the composition.
 */
export function InlineTextEditor({
  initialText,
  placeholder,
  style,
  ariaLabel,
  onCommit,
  onReady,
  onLayout,
}: {
  initialText: string;
  placeholder: string;
  style?: CSSProperties;
  ariaLabel: string;
  onCommit: (text: string, element: HTMLDivElement) => void;
  onReady?: (element: HTMLDivElement | null) => void;
  /** Fires whenever the box changes size while typing, so the owner can keep it inside the page. */
  onLayout?: (element: HTMLDivElement) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const committedRef = useRef(false);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onLayoutRef = useRef(onLayout);
  onLayoutRef.current = onLayout;

  const commit = () => {
    const element = ref.current;
    if (!element || committedRef.current) return;
    committedRef.current = true;
    onCommitRef.current(normalizeInlineText(element.innerText), element);
  };

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    element.textContent = initialText;
    element.classList.toggle('is-empty', initialText.length === 0);
    onReady?.(element);
    element.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return () => onReady?.(null);
    // The editor is keyed by its target; initial text is only read on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => onLayoutRef.current?.(element));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const stop = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commit();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    document.execCommand('insertText', false, text.replace(/\r\n?/g, '\n'));
  };

  return (
    <div
      ref={ref}
      className="annotation-text-editor"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      data-placeholder={placeholder}
      spellCheck={false}
      style={style}
      onInput={(event) => {
        const element = event.currentTarget;
        element.classList.toggle('is-empty', normalizeInlineText(element.innerText).length === 0);
      }}
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => event.stopPropagation()}
      onKeyPress={(event) => event.stopPropagation()}
      onBlur={commit}
      onPaste={handlePaste}
      onMouseDown={stop}
      onMouseUp={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
    />
  );
}
