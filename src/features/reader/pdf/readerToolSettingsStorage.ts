import { defaultReaderToolSettings, type ReaderToolSettings } from './types';

export const READER_TOOL_SETTINGS_STORAGE_KEY = 'aster.reader.annotationToolSettings.v1';

export function normalizeStoredReaderToolSettings(value: unknown): ReaderToolSettings {
  const stored = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ReaderToolSettings>
    : {};
  const rawFontSize = finiteNumber(stored.textFontSize, defaultReaderToolSettings.textFontSize);
  // 13 was the historical default, so it is not treated as an explicit modern choice.
  const migratedFontSize = rawFontSize === 13 ? 24 : rawFontSize;
  const textFontSize = nearestEven(Math.max(2, Math.min(64, migratedFontSize)));
  return {
    ...defaultReaderToolSettings,
    ...stored,
    inkStrokeWidth: finiteNumber(stored.inkStrokeWidth, defaultReaderToolSettings.inkStrokeWidth),
    eraserSize: finiteNumber(stored.eraserSize, defaultReaderToolSettings.eraserSize),
    arrowStrokeWidth: finiteNumber(stored.arrowStrokeWidth, defaultReaderToolSettings.arrowStrokeWidth),
    shapeStrokeWidth: finiteNumber(stored.shapeStrokeWidth, defaultReaderToolSettings.shapeStrokeWidth),
    textFontSize,
  } as ReaderToolSettings;
}

export function loadReaderToolSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()) {
  if (!storage) return defaultReaderToolSettings;
  try {
    const raw = storage.getItem(READER_TOOL_SETTINGS_STORAGE_KEY);
    return normalizeStoredReaderToolSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultReaderToolSettings;
  }
}

export function saveReaderToolSettings(settings: ReaderToolSettings, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  if (!storage) return;
  try { storage.setItem(READER_TOOL_SETTINGS_STORAGE_KEY, JSON.stringify(settings)); } catch { /* preference persistence is best effort */ }
}

function nearestEven(value: number) { return Math.max(2, Math.min(64, Math.round(value / 2) * 2)); }
function finiteNumber(value: unknown, fallback: number) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function safeStorage() { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }
