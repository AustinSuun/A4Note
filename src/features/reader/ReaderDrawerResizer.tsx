import { useReaderDrawerGesture } from './useReaderDrawerGesture';
export function ReaderDrawerResizer({ width, maximum, onChange }: { width: number; maximum: number; onChange: (width: number) => void }) {
  const gesture = useReaderDrawerGesture({ resize: { width, maximum, onChange } });
  return <div className="reader-drawer-resize-handle" role="separator" aria-label="调整笔记侧栏宽度" aria-orientation="vertical"
    aria-valuemin={300} aria-valuemax={maximum} aria-valuenow={Math.round(width)} tabIndex={0}
    onDoubleClick={() => onChange(420)} onKeyDown={event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onChange(width + (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 60 : 20)); }
      if (event.key === 'Home') { event.preventDefault(); onChange(300); }
      if (event.key === 'End') { event.preventDefault(); onChange(maximum); }
    }} onPointerDown={gesture.onPointerDown} />;
}
