import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { PaperDocument } from '../../core/types';
import { zh } from '../../ui/zh';
import { annotationLabelText } from './readerHelpers';
import { MarkdownCallout, MarkdownCodeBlock, MarkdownFigure, MarkdownFootnoteBackref, MarkdownFootnoteRef, MarkdownFootnotesSection, MarkdownTable, remarkAsterInline, wikiLinkProtocol, wikiLinkTarget } from '../../shared/markdown';

export function MarkdownReadContent({
  markdown,
  paper,
  onNavigateAnnotation,
}: {
  markdown: string;
  paper: PaperDocument;
  onNavigateAnnotation: (annotationId: string) => void;
}) {
  const annotationReferencePattern = /@annotation\(([^)]+)\)/g;

  const markdownWithAnnotationLinks = markdown.replace(annotationReferencePattern, (source, rawAnnotationId: string) => {
    const annotationId = rawAnnotationId.trim();
    const annotation = paper.annotations.find((item) => item.id === annotationId);
    if (!annotation) return source;
    const label = `${annotationLabelText(annotation.type)} · ${zh.reader.annotationPage(annotation.page)}`;
    return `[${label}](a4note-annotation:${encodeURIComponent(annotation.id)})`;
  });

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkAsterInline]}
      rehypePlugins={[rehypeKatex]}
      urlTransform={(url) => (url.startsWith('a4note-annotation:') || url.startsWith(wikiLinkProtocol) ? url : defaultUrlTransform(url))}
      components={{
        img: ({ src, alt, title }) => <MarkdownFigure src={typeof src === 'string' ? src : undefined} alt={alt} title={title} />,
        blockquote: MarkdownCallout,
        pre: MarkdownCodeBlock,
        table: MarkdownTable,
        section: ({ children, ...props }) => {
          // GFM footnotes emit <section data-footnotes>
          if ('data-footnotes' in props) return <MarkdownFootnotesSection>{children}</MarkdownFootnotesSection>;
          return <section {...props}>{children}</section>;
        },
        a: ({ href, children, ...props }) => {
          // Footnote reference link [^1]
          if ('data-footnote-ref' in props) return <MarkdownFootnoteRef href={href}>{children}</MarkdownFootnoteRef>;
          // Footnote backref (return arrow)
          if ('data-footnote-backref' in props) return <MarkdownFootnoteBackref href={href}>{children}</MarkdownFootnoteBackref>;
          // Internal note link. Reader notes live in the database and have no
          // vault to resolve against, so it renders as inert text.
          if (href?.startsWith(wikiLinkProtocol)) {
            const target = wikiLinkTarget(href);
            return <span className="markdown-wiki-link is-unresolved" title={`笔记链接：${target}（在笔记工作区中打开）`}>{children}</span>;
          }
          // Annotation link
          if (href?.startsWith('a4note-annotation:')) {
            const annotationId = decodeURIComponent(href.slice('a4note-annotation:'.length));
            return (
              <button type="button" className="annotation-reference" onClick={() => onNavigateAnnotation(annotationId)}>
                {children}
              </button>
            );
          }
          // Regular link
          return <a className="markdown-link" data-external={/^https?:/i.test(href ?? '') ? 'true' : undefined} href={href} target="_blank" rel="noreferrer">{children}</a>;
        },
      }}
    >
      {markdownWithAnnotationLinks}
    </ReactMarkdown>
  );
}
