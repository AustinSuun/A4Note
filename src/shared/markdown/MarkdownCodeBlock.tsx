import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Check, Copy } from 'lucide-react';
import { markdownNodeText } from './MarkdownCallout';
import { describeFenceLanguage, highlightFence, loadFenceLanguage } from './highlight';

/** Shared fenced-code preview; theme rules live in markdown.css. */
function fenceLanguage(children: ReactNode) {
  const child = Children.toArray(children).find((node) => isValidElement(node));
  if (!isValidElement(child)) return '';
  const className = (child.props as { className?: string }).className ?? '';
  return className.match(/language-([\w+#.-]+)/)?.[1] ?? '';
}

type CopyState = 'idle' | 'pending' | 'copied' | 'failed';

export function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  const language = fenceLanguage(children);
  const code = markdownNodeText(children);
  const [highlighted, setHighlighted] = useState<{ code: string; language: string; nodes: ReactNode[] } | null>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const requestRef = useRef(0);
  const pendingRef = useRef(false);

  useEffect(() => {
    // Plain text remains available if a language is unknown or its chunk fails.
    setHighlighted(null);
    if (!language || !describeFenceLanguage(language)) return undefined;
    let cancelled = false;
    void loadFenceLanguage(language).then((resolved) => {
      if (cancelled || !resolved) return;
      setHighlighted({ code, language, nodes: highlightFence(code, resolved) });
    }).catch(() => { /* Preserve the plain-text fallback. */ });
    return () => { cancelled = true; };
  }, [code, language]);

  useEffect(() => {
    setCopyState('idle');
    pendingRef.current = false;
    return () => { requestRef.current += 1; pendingRef.current = false; };
  }, [code]);

  useEffect(() => {
    if (copyState !== 'copied' && copyState !== 'failed') return undefined;
    const timer = window.setTimeout(() => setCopyState('idle'), copyState === 'failed' ? 5000 : 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const copyCode = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    const request = ++requestRef.current;
    setCopyState('pending');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      // Copy authored text, not DOM text that may include controls or stale highlighting.
      await navigator.clipboard.writeText(code);
      if (request === requestRef.current) setCopyState('copied');
    } catch {
      if (request === requestRef.current) setCopyState('failed');
    } finally {
      if (request === requestRef.current) pendingRef.current = false;
    }
  };

  const message = copyState === 'copied' ? '已复制代码'
    : copyState === 'failed' ? '复制失败，请选中代码手动复制'
      : copyState === 'pending' ? '正在复制…' : '';
  const currentHighlight = highlighted?.code === code && highlighted.language === language ? highlighted.nodes : null;

  return (
    <div className={language ? 'markdown-code-block has-language' : 'markdown-code-block'}>
      {language && <span className="markdown-code-language" aria-hidden="true">{language}</span>}
      <button
        type="button"
        className="markdown-code-copy"
        title={message || '复制代码'}
        aria-label={message || '复制代码'}
        disabled={copyState === 'pending'}
        onClick={() => { void copyCode(); }}
      >
        {copyState === 'copied' ? <Check size={14} aria-hidden="true" />
          : copyState === 'failed' ? <AlertCircle size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
      <pre tabIndex={0} aria-label={language ? `${language} 代码，可滚动` : '代码，可滚动'}>{currentHighlight ? <code className={`language-${language}`}>{currentHighlight}</code> : children}</pre>
      <span className="markdown-code-feedback" role="status" aria-live="polite" aria-atomic="true">{message}</span>
    </div>
  );
}

/** Wide tables stay within their own keyboard-accessible scroll region. */
export function MarkdownTable({ children }: { children?: ReactNode }) {
  return (
    <div className="markdown-table-wrap" tabIndex={0} role="region" aria-label="表格，可横向滚动">
      <table>{children}</table>
    </div>
  );
}
