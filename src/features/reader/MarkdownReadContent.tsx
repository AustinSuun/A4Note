import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PaperDocument } from '../../core/types';
import { zh } from '../../ui/zh';
import { annotationLabelText } from './readerHelpers';

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
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => (url.startsWith('a4note-annotation:') ? url : defaultUrlTransform(url))}
      components={{
        a: ({ href, children }) => {
          if (href?.startsWith('a4note-annotation:')) {
            const annotationId = decodeURIComponent(href.slice('a4note-annotation:'.length));
            return (
              <button type="button" className="annotation-reference" onClick={() => onNavigateAnnotation(annotationId)}>
                {children}
              </button>
            );
          }
          return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
        },
      }}
    >
      {markdownWithAnnotationLinks}
    </ReactMarkdown>
  );
}
