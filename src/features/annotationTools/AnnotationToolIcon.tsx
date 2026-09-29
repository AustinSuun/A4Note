import type { ReaderTool } from '../../core/types';
import { dockIconPaths } from '../../shared/dockIconPaths';

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/** One icon per annotation tool id; the reader and the board render the same glyphs. */
export function AnnotationToolIcon({ id }: { id: ReaderTool }) {
  if (id === 'cursor') return <Icon path="M6 4.5 16.5 15H11l-2 4-3-11.5Z" />;
  if (id === 'hand') return <Icon path="M8 13V6a2 2 0 0 1 4 0v6M12 11V4a2 2 0 0 1 4 0v8M16 11V7a2 2 0 0 1 4 0v8c0 4-2.5 6-6 6h-1c-2 0-3.5-1-4.5-2.5L4 12a2 2 0 0 1 3-2l1 3Z" />;
  if (id === 'comment') return <Icon path={dockIconPaths.comment} />;
  if (id === 'underline') return <Icon path={dockIconPaths.underline} />;
  if (id === 'text') return <Icon path="M5 6h14M12 6v12M8 18h8" />;
  if (id === 'ink') return <Icon path="M4 17c3-6 5 3 8-3s4-5 8-2M14 4l6 6M16 4l4 4" />;
  if (id === 'eraser') return <Icon path="M5 15 14 6a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3l-7 7H7l-2-3Zm7 3h8" />;
  if (id === 'rect') return <Icon path="M5 6h14v12H5z" />;
  if (id === 'arrow') return <Icon path="M5 19 19 5M11 5h8v8" />;
  if (id === 'area') return <Icon path="M7 7h10v10H7zM4 10h2M18 10h2M10 4v2M10 18v2" />;
  return <Icon path={dockIconPaths.highlight} />;
}
