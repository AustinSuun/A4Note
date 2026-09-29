/**
 * Shared annotation tool settings (task 97fcfb6c).
 *
 * The PDF reader and the whiteboard expose the same drawing tools (ink, text, shapes,
 * arrows, eraser). Their option values – stroke widths, eraser size/shape, arrow style,
 * text style, shape kind/fill – and the per-tool "last used colour" live in ONE store so a
 * change made in either place is what the other one picks up next. Each host still keeps
 * its own *active tool*; only defaults / recent values are shared.
 *
 * Persistence keeps the reader's historical key so existing preferences migrate as-is.
 */
import { useCallback, useSyncExternalStore } from 'react';

export type ArrowStyle = 'solid' | 'dashed' | 'double';
export type ArrowEnding = 'arrow' | 'line';
export type EraserShape = 'round' | 'square';
export type ShapeKind = 'rect' | 'ellipse';

export type AnnotationToolSettings = {
  inkStrokeWidth: number;
  eraserSize: number;
  eraserShape: EraserShape;
  arrowStyle: ArrowStyle;
  arrowEnding: ArrowEnding;
  arrowStrokeWidth: number;
  textBold: boolean;
  textItalic: boolean;
  textFontSize: number;
  textColor: string;
  textBorderColor: string;
  textBackgroundColor: string;
  shapeKind: ShapeKind;
  shapeFillEnabled: boolean;
  shapeStrokeWidth: number;
};

export const defaultAnnotationToolSettings: AnnotationToolSettings = {
  inkStrokeWidth: 4,
  eraserSize: 18,
  eraserShape: 'round',
  arrowStyle: 'solid',
  arrowEnding: 'arrow',
  arrowStrokeWidth: 3.4,
  textBold: false,
  textItalic: false,
  textFontSize: 24,
  textColor: '#202822',
  textBorderColor: '#ffffff',
  textBackgroundColor: 'transparent',
  shapeKind: 'rect',
  shapeFillEnabled: false,
  shapeStrokeWidth: 2.4,
};

/** Tools whose colour is remembered per tool and shared between the reader and the board. */
export type SharedColorTool = 'highlight' | 'underline' | 'text' | 'ink' | 'rect' | 'arrow' | 'comment' | 'area';
export type SharedToolColors = Partial<Record<SharedColorTool, string>>;

/** Historical reader key – kept so existing preferences migrate without a copy step. */
export const ANNOTATION_TOOL_SETTINGS_STORAGE_KEY = 'aster.reader.annotationToolSettings.v1';
export const ANNOTATION_TOOL_COLORS_STORAGE_KEY = 'aster.annotationTools.toolColors.v1';

export function normalizeStoredAnnotationToolSettings(value: unknown): AnnotationToolSettings {
  const stored = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<AnnotationToolSettings>
    : {};
  const rawFontSize = finiteNumber(stored.textFontSize, defaultAnnotationToolSettings.textFontSize);
  // 13 was the historical default, so it is not treated as an explicit modern choice.
  const migratedFontSize = rawFontSize === 13 ? 24 : rawFontSize;
  const textFontSize = nearestEven(Math.max(2, Math.min(64, migratedFontSize)));
  return {
    ...defaultAnnotationToolSettings,
    ...stored,
    inkStrokeWidth: finiteNumber(stored.inkStrokeWidth, defaultAnnotationToolSettings.inkStrokeWidth),
    eraserSize: finiteNumber(stored.eraserSize, defaultAnnotationToolSettings.eraserSize),
    arrowStrokeWidth: finiteNumber(stored.arrowStrokeWidth, defaultAnnotationToolSettings.arrowStrokeWidth),
    shapeStrokeWidth: finiteNumber(stored.shapeStrokeWidth, defaultAnnotationToolSettings.shapeStrokeWidth),
    textFontSize,
  } as AnnotationToolSettings;
}

export function normalizeStoredToolColors(value: unknown): SharedToolColors {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const colors: SharedToolColors = {};
  for (const [tool, color] of Object.entries(value as Record<string, unknown>)) {
    if (typeof color === 'string' && (isPresetColorName(color) || /^#[0-9a-fA-F]{6}$/.test(color))) colors[tool as SharedColorTool] = color;
  }
  return colors;
}

export function isPresetColorName(color: string) {
  return color === 'yellow' || color === 'green' || color === 'blue' || color === 'purple';
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadAnnotationToolSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()) {
  if (!storage) return defaultAnnotationToolSettings;
  try {
    const raw = storage.getItem(ANNOTATION_TOOL_SETTINGS_STORAGE_KEY);
    return normalizeStoredAnnotationToolSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultAnnotationToolSettings;
  }
}

export function saveAnnotationToolSettings(settings: AnnotationToolSettings, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  if (!storage) return;
  try { storage.setItem(ANNOTATION_TOOL_SETTINGS_STORAGE_KEY, JSON.stringify(settings)); } catch { /* preference persistence is best effort */ }
}

export function loadSharedToolColors(storage: Pick<Storage, 'getItem'> | null = safeStorage()): SharedToolColors {
  if (!storage) return {};
  try {
    const raw = storage.getItem(ANNOTATION_TOOL_COLORS_STORAGE_KEY);
    return normalizeStoredToolColors(raw ? JSON.parse(raw) : null);
  } catch {
    return {};
  }
}

export function saveSharedToolColors(colors: SharedToolColors, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  if (!storage) return;
  try { storage.setItem(ANNOTATION_TOOL_COLORS_STORAGE_KEY, JSON.stringify(colors)); } catch { /* best effort */ }
}

/**
 * Minimal external store: module state + listeners. Both hosts subscribe through
 * `useSyncExternalStore`, so a change in the reader re-renders the board (and vice
 * versa) within the same window; the `storage` event covers other windows.
 */
export interface AnnotationToolStore {
  getSettings(): AnnotationToolSettings;
  setSettings(next: AnnotationToolSettings | ((current: AnnotationToolSettings) => AnnotationToolSettings)): void;
  getToolColors(): SharedToolColors;
  setToolColor(tool: SharedColorTool, color: string): void;
  subscribe(listener: () => void): () => void;
  /** Re-read storage (tests, or after another window wrote it). */
  reload(): void;
}

export function createAnnotationToolStore(storage: StorageLike | null = safeStorage()): AnnotationToolStore {
  let settings = loadAnnotationToolSettings(storage);
  let colors = loadSharedToolColors(storage);
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of [...listeners]) listener(); };
  return {
    getSettings: () => settings,
    setSettings(next) {
      const resolved = typeof next === 'function' ? next(settings) : next;
      if (resolved === settings) return;
      settings = normalizeStoredAnnotationToolSettings(resolved);
      saveAnnotationToolSettings(settings, storage);
      emit();
    },
    getToolColors: () => colors,
    setToolColor(tool, color) {
      if (colors[tool] === color) return;
      colors = { ...colors, [tool]: color };
      saveSharedToolColors(colors, storage);
      emit();
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reload() {
      settings = loadAnnotationToolSettings(storage);
      colors = loadSharedToolColors(storage);
      emit();
    },
  };
}

let defaultStore: AnnotationToolStore | null = null;
export function annotationToolStore(): AnnotationToolStore {
  if (!defaultStore) {
    defaultStore = createAnnotationToolStore();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        if (event.key === ANNOTATION_TOOL_SETTINGS_STORAGE_KEY || event.key === ANNOTATION_TOOL_COLORS_STORAGE_KEY) defaultStore?.reload();
      });
    }
  }
  return defaultStore;
}

/** Shared option values (widths, eraser, arrow, text, shape). */
export function useSharedAnnotationToolSettings(store: AnnotationToolStore = annotationToolStore()): [AnnotationToolSettings, (next: AnnotationToolSettings | ((current: AnnotationToolSettings) => AnnotationToolSettings)) => void] {
  const settings = useSyncExternalStore(store.subscribe, store.getSettings, store.getSettings);
  const setSettings = useCallback((next: AnnotationToolSettings | ((current: AnnotationToolSettings) => AnnotationToolSettings)) => store.setSettings(next), [store]);
  return [settings, setSettings];
}

/** Per-tool recent colours; `fallback` supplies the defaults for tools never touched. */
export function useSharedToolColors(store: AnnotationToolStore = annotationToolStore()): [SharedToolColors, (tool: SharedColorTool, color: string) => void] {
  const colors = useSyncExternalStore(store.subscribe, store.getToolColors, store.getToolColors);
  const setToolColor = useCallback((tool: SharedColorTool, color: string) => store.setToolColor(tool, color), [store]);
  return [colors, setToolColor];
}

function nearestEven(value: number) { return Math.max(2, Math.min(64, Math.round(value / 2) * 2)); }
function finiteNumber(value: unknown, fallback: number) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function safeStorage(): StorageLike | null { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }
