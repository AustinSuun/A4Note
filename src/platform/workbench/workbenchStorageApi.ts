/**
 * Workbench snapshot persistence (PWS-1).
 *
 * The workbench model and its serialization live in `src/core/workspace.ts`;
 * this adapter only moves the serialized text between the store and SQLite.
 * `WorkbenchSnapshotStorage` is declared here rather than imported from
 * `src/workbench` so the dependency stays `platform -> core` only; it is
 * structurally the same shape the store already accepts.
 */
import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../projects';

/** Pre-PWS-1 snapshots lived here. Kept readable for the one-time migration. */
const LEGACY_STORAGE_KEY = 'aster.workbench';

/** A burst of tab mutations should land as one transaction, not one each. */
const WRITE_DEBOUNCE_MS = 250;

export interface WorkbenchSnapshotStorage {
  read(): string | null;
  write(value: string): void;
}

/** `null` means the workbench has never been saved on this machine. */
export function loadWorkbenchSnapshot() {
  return invoke<string | null>('load_workbench_state');
}

export function saveWorkbenchSnapshot(snapshot: string) {
  return invoke<void>('save_workbench_state', { request: { snapshot } });
}

function readLegacySnapshot(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * `read()` stays synchronous because the store seeds itself from it before the
 * first render, so the snapshot is fetched once during bootstrap and cached
 * here. Writes are debounced and chained: a later snapshot can never be
 * overtaken by an earlier one still in flight.
 */
function sqliteStorage(initial: string | null): WorkbenchSnapshotStorage {
  let latest = initial;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<void> = Promise.resolve();

  const flush = () => {
    timer = null;
    const value = latest;
    if (value === null) return;
    queue = queue
      .then(() => saveWorkbenchSnapshot(value))
      .catch((error) => {
        console.warn('保存工作台状态失败', error);
      });
  };

  if (typeof window !== 'undefined') {
    // Closing the window must not drop the last few hundred milliseconds of
    // tab changes.
    window.addEventListener('beforeunload', () => {
      if (!timer) return;
      clearTimeout(timer);
      flush();
    });
  }

  return {
    read: () => latest,
    write: (value) => {
      latest = value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, WRITE_DEBOUNCE_MS);
    },
  };
}

/**
 * Returns `null` outside the desktop runtime, or when SQLite cannot be read,
 * so the store keeps its own `localStorage` default instead of starting from a
 * fabricated empty workbench.
 */
export async function createWorkbenchStorage(): Promise<WorkbenchSnapshotStorage | null> {
  if (!isTauriRuntime()) return null;
  let initial: string | null;
  try {
    initial = await loadWorkbenchSnapshot();
  } catch (error) {
    console.warn('读取工作台状态失败，暂时回退到浏览器存储', error);
    return null;
  }
  if (initial === null) {
    // One-time migration. The legacy key is left in place so an older build
    // still finds its snapshot after a downgrade.
    const legacy = readLegacySnapshot();
    if (legacy) {
      initial = legacy;
      try {
        await saveWorkbenchSnapshot(legacy);
      } catch (error) {
        console.warn('迁移旧工作台状态失败，本次仍使用内存快照', error);
      }
    }
  }
  return sqliteStorage(initial);
}
