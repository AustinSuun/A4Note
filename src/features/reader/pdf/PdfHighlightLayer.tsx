import type { AnnotationMarkModel } from './types';
import { highlightFill, highlightRects } from './pdfHighlightAppearance';
import { useHighlightAppearance } from './useHighlightAppearance';
import './pdf-highlight.css';

/** Paint once, then composite once: duplicate/overlapping marks cannot compound alpha.
 * IDs and hit targets stay in AnnotationOverlay; the last mark's color wins overlaps.
 * A sibling of the interaction layer is necessary: its z-index used to isolate blend
 * operations from the PDF bitmap, washing out glyphs despite `multiply` on each mark.
 */
export function PdfHighlightLayer({ annotations }: { annotations: readonly AnnotationMarkModel[] }) {
  const { appearance } = useHighlightAppearance();
  return <svg className="pdf-highlight-paint" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"
    style={{ opacity: appearance.opacity / 100, mixBlendMode: appearance.blend }}>
    {annotations.filter(mark => mark.type === 'highlight').flatMap((mark, index) =>
      highlightRects(mark.positionJson).map((rect, segment) =>
        <rect key={`${mark.id ?? index}-${index}-${segment}`} {...rect} fill={highlightFill(mark.color)} />))}
  </svg>;
}
