/* Fixture for scripts/verify-library-storage-browser.mjs (task 6557dc15).
 * Mounts the real storage settings block and the library notice on top of a scripted
 * `__TAURI_INTERNALS__` so the whole invoke/event path runs without a native host. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/ui/styles/tokens.css';
import '/src/features/settings/settings.css';
import { LibraryStorageSettings } from '/src/features/settings/sections/LibraryStorageSettings';
import { LibraryStorageNotice } from '/src/features/library/LibraryStorageNotice';

type Call = [string, unknown];
const ROOT = 'C:\\Users\\demo\\AppData\\Roaming\\app.aster.research\\AsterData';
const DEFAULT_FILES = ROOT + '\\files';
const RECOMMENDED = 'D:\\A4Note\\files';

const mock = {
  calls: [] as Call[],
  delay: 0,
  failNext: null as string | null,
  pickResult: null as string | null,
  cancelled: false,
  listeners: {} as Record<string, number>,
  info: {
    root: ROOT,
    filesRoot: DEFAULT_FILES,
    papersRoot: DEFAULT_FILES + '\\papers',
    defaultFilesRoot: DEFAULT_FILES,
    isCustom: false,
    freeBytes: 30 * 1024 ** 3,
    totalBytes: 250 * 1024 ** 3,
    filesSizeBytes: Math.round(2.3 * 1024 ** 3),
    onSystemDrive: true as boolean | null,
    recommendedRoot: RECOMMENDED as string | null,
    promptDismissed: false,
    isolated: false,
    migrationActive: false,
    captureCacheRoot: 'C:\\Users\\demo\\AppData\\Roaming\\app.aster.research\\A4CaptureData',
  },
  emit(event: string, payload: unknown) {
    const handler = this.listeners[event];
    const callback = handler ? (window as unknown as Record<string, (data: unknown) => void>)[`_${handler}`] : null;
    callback?.({ event, id: 1, payload });
  },
};
let callbackSeq = 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const internals = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
  transformCallback(callback: (data: unknown) => void) {
    const id = ++callbackSeq;
    (window as unknown as Record<string, unknown>)[`_${id}`] = callback;
    return id;
  },
  async invoke(cmd: string, args: Record<string, unknown> = {}) {
    mock.calls.push([cmd, args]);
    switch (cmd) {
      case 'plugin:event|listen': mock.listeners[String(args.event)] = Number(args.handler); return callbackSeq;
      case 'plugin:event|unlisten': return null;
      case 'plugin:dialog|open': return mock.pickResult;
      case 'get_library_storage': return { ...mock.info };
      case 'validate_library_files_root': {
        const path = String(args.path);
        if (path.toLowerCase().startsWith(ROOT.toLowerCase())) throw '文件存储位置不能位于资料库数据目录内部，也不能包含数据目录。';
        return { path, onSystemDrive: /^c:/i.test(path), freeBytes: mock.info.freeBytes, totalBytes: mock.info.totalBytes };
      }
      case 'set_library_files_root': {
        if (mock.failNext) { const message = mock.failNext; mock.failNext = null; throw message; }
        const target = (args.path as string | null) ?? DEFAULT_FILES;
        const migrate = Boolean(args.migrate);
        mock.cancelled = false;
        if (migrate && mock.delay > 0) {
          const total = 3;
          for (let step = 0; step <= total; step += 1) {
            mock.emit('library://storage-migration', { phase: 'copying', copiedFiles: step, totalFiles: total, copiedBytes: step * 1024 * 1024, totalBytes: total * 1024 * 1024, current: step ? `paper-${step}\\source.pdf` : null });
            await sleep(mock.delay / (total + 1));
            if (mock.cancelled) throw '迁移已取消，资料库与文件均未改动。';
          }
          mock.emit('library://storage-migration', { phase: 'database', copiedFiles: total, totalFiles: total, copiedBytes: total * 1024 * 1024, totalBytes: total * 1024 * 1024, current: null });
        }
        mock.info = { ...mock.info, filesRoot: target, papersRoot: target + '\\papers', isCustom: Boolean(args.path), recommendedRoot: args.path ? null : RECOMMENDED, onSystemDrive: /^c:/i.test(target) };
        return { from: DEFAULT_FILES + '\\papers', to: target + '\\papers', filesMoved: migrate ? 3 : 0, bytesMoved: migrate ? 3 * 1024 * 1024 : 0, databaseRowsUpdated: migrate ? 3 : 0, warnings: [], filesRoot: target, isCustom: Boolean(args.path) };
      }
      case 'cancel_library_files_root_migration': mock.cancelled = true; return null;
      case 'dismiss_library_storage_prompt': mock.info = { ...mock.info, promptDismissed: true }; return null;
      default: throw new Error('unknown command ' + cmd);
    }
  },
};
(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = internals;
/* `listen()`'s unlisten path unregisters through the event plugin globals in a real shell. */
(window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
(window as unknown as Record<string, unknown>).__storageMock = mock;

function Host() {
  return (
    <div className="storage-harness">
      <section className="scene library-scene" style={{ marginBottom: 16 }}>
        <section className="library-main" style={{ display: 'flex', flexDirection: 'column' }}>
          <LibraryStorageNotice />
        </section>
      </section>
      <div className="settings-section-body" style={{ maxWidth: 760 }}>
        <LibraryStorageSettings
          onChanged={() => { mock.calls.push(['onChanged', null]); }}
          onReveal={() => { mock.calls.push(['onReveal', 'files']); }}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Host /></StrictMode>);
