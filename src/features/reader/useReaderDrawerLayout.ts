import { useEffect, useRef, useState } from 'react';
const widthKey = 'a4note.reader.noteDrawerWidth';
export function useReaderDrawerLayout() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(1000);
  const [width, setWidth] = useState(() => { try { const n = Number(localStorage.getItem(widthKey)); return n >= 300 && n <= 4000 ? n : 420; } catch { return 420; } });
  const [expanded, setExpanded] = useState(false);
  const compact = available < 720;
  const maximum = Math.max(300, available - 332);
  const clamped = compact ? Math.max(0, available) : Math.min(maximum, Math.max(300, width));
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => { if (element.clientWidth > 0) setAvailable(element.clientWidth); };
    measure(); const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null; observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { try { localStorage.setItem(widthKey, String(width)); } catch { /* geometry only */ } }, 200);
    return () => window.clearTimeout(timer);
  }, [width]);
  const changeWidth = (next: number) => {
    const value = Math.round(Math.min(maximum, Math.max(300, next)));
    setWidth(value);
  };
  return { containerRef, width: clamped, maximum, compact, expanded, setExpanded, changeWidth };
}
