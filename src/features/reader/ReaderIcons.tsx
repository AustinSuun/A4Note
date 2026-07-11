import type { ReaderTool } from '../../core/types';

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function AnnotationToolIcon({ id }: { id: ReaderTool }) {
  if (id === 'cursor') return <Icon path="M6 4.5 16.5 15H11l-2 4-3-11.5Z" />;
  if (id === 'comment') return <Icon path="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v6A2.5 2.5 0 0 1 17.5 15H11l-4.5 4v-4A2.5 2.5 0 0 1 4 12.5v-6Z" />;
  if (id === 'underline') return <Icon path="M7 5v5a5 5 0 0 0 10 0V5M6 19h12" />;
  if (id === 'text') return <Icon path="M5 6h14M12 6v12M8 18h8" />;
  if (id === 'ink') return <Icon path="M4 17c3-6 5 3 8-3s4-5 8-2M14 4l6 6M16 4l4 4" />;
  if (id === 'eraser') return <Icon path="M5 15 14 6a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3l-7 7H7l-2-3Zm7 3h8" />;
  if (id === 'rect') return <Icon path="M5 6h14v12H5z" />;
  if (id === 'arrow') return <Icon path="M5 19 19 5M11 5h8v8" />;
  if (id === 'area') return <Icon path="M7 7h10v10H7zM4 10h2M18 10h2M10 4v2M10 18v2" />;
  return <Icon path="M5 14.5 11.5 8 14 10.5 19 5.5 17.5 4 14 7.5 11.5 5 5 11.5Z" />;
}

export function NotesIcon() {
  return <Icon path="M7 4h10a2 2 0 0 1 2 2v14H8a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2Zm1 13h11M9 8h6M9 11h7" />;
}

export function AnnotationsIcon() {
  return <Icon path="M5 15 15 5l4 4L9 19H5v-4Zm10-10 4 4M6 21h12" />;
}

export function ChatIcon() {
  return <Icon path="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v6A2.5 2.5 0 0 1 17.5 15H11l-4.5 4v-4A2.5 2.5 0 0 1 4 12.5v-6Z" />;
}

export function RelationsIcon() {
  return <Icon path="M8 7a3 3 0 1 0 0 .1M16 17a3 3 0 1 0 0 .1M17 6.5a2.5 2.5 0 1 0 0 .1M10.5 8.5l3.2 5.1M10.5 6.7l4-.4M9.8 15.6l3.4 1.1" />;
}

export function SidebarIcon() {
  return <Icon path="M4 5h16v14H4V5Zm11 0v14M7 9h5M7 12h5M7 15h5" />;
}

export function TrashIcon() {
  return <Icon path="M6 7h12M10 7V5h4v2M8 7l.8 12h6.4L16 7M10.5 10v6M13.5 10v6" />;
}

export function ZoomOutIcon() {
  return <Icon path="M11 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm6 10 3 3M9 11h4" />;
}

export function ZoomInIcon() {
  return <Icon path="M11 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm6 10 3 3M11 9v4M9 11h4" />;
}

export function FitWidthIcon() {
  return <Icon path="M4 8V5h3M20 8V5h-3M4 16v3h3M20 16v3h-3M8 12h8" />;
}
