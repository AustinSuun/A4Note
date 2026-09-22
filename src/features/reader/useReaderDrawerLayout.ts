import { useEffect, useLayoutEffect, useRef, useState } from 'react';
const widthKey = 'a4note.reader.noteDrawerWidth';
export function useReaderDrawerLayout() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(1000);
  const [width, setWidth] = useState(() => { try { const n = Number(localStorage.getItem(widthKey)); return n >= 300 && n <= 4000 ? n : 420; } catch { return 420; } });
  const [expanded, setExpanded] = useState(false);
  const compact = available < 720;
  const maximum = Math.max(300, available - 332);
  const clamped = compact ? Math.max(0, available) : Math.min(maximum, Math.max(300, width));
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    // The outer workbench has a desktop minimum width. At high UI zoom that
    // minimum can exceed the viewport: constrain this reader, not the global shell,
    // so its boundary controls and floating card remain on screen.
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = element.getBoundingClientRect();
      const scale = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const padding = element.parentElement ? Number.parseFloat(getComputedStyle(element.parentElement).paddingRight) || 0 : 0;
      element.style.maxWidth = `${Math.max(0, (window.innerWidth - box.left) / scale - padding)}px`;
      if (element.clientWidth > 0) setAvailable(element.clientWidth);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null; observer?.observe(element);
    const zoomObserver = new MutationObserver(schedule); zoomObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', schedule);
    return () => { observer?.disconnect(); zoomObserver.disconnect(); if (frame) cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { try { localStorage.setItem(widthKey, String(width)); } catch { /* geometry only */ } }, 200);
    return () => window.clearTimeout(timer);
  }, [width]);
  const changeWidth = (next: number) => {
    const value = Math.round(Math.min(maximum, Math.max(300, next)));
    setWidth(value);
  };
  return { containerRef, width: clamped, maximum, available, compact, expanded, setExpanded, changeWidth };
}
