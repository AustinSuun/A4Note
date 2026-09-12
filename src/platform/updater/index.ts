import { check, type Update } from '@tauri-apps/plugin-updater';
import { getVersion } from '@tauri-apps/api/app';
import { flushPendingSaves } from '../pendingSaves';
import { openExternalUrl, isTauriRuntime } from '../projects';

export const releasePage = 'https://github.com/AustinSuun/A4Note/releases/latest';
type Phase = 'idle' | 'checking' | 'available' | 'latest' | 'downloading' | 'downloaded' | 'installing' | 'error';
interface Snapshot { phase: Phase; current: string; version?: string; notes?: string; received: number; total?: number; downloaded: boolean; error?: string; }
let snapshot: Snapshot = { phase: 'idle', current: '', received: 0, downloaded: false };
let candidate: Update | null = null;
let busy = false;
const listeners = new Set<() => void>();
const publish = (patch: Partial<Snapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(fn => fn()); };
export const updateSnapshot = () => snapshot;
export const subscribeUpdates = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const openReleases = () => openExternalUrl(releasePage);
export async function checkForUpdates() {
  if (busy) return;
  busy = true;
  publish({ phase: 'checking', error: undefined, version: undefined, notes: undefined, downloaded: false, received: 0, total: undefined });
  try {
    if (!isTauriRuntime()) throw new Error('请在已安装的桌面软件中检查更新');
    if (candidate) { const old = candidate; candidate = null; await old.close(); }
    const current = await getVersion(); publish({ current });
    candidate = await check({ timeout: 30000 });
    publish(candidate ? { phase: 'available', version: candidate.version, notes: candidate.body?.slice(0, 20000) } : { phase: 'latest' });
  } catch (error) {
    publish({ phase: 'error', error: `检查更新失败：${String(error)}。请重试或前往官方发布页；网络失败不代表已是最新版。` });
  } finally { busy = false; }
}
export async function downloadUpdate() {
  if (busy || !candidate || snapshot.downloaded) return;
  busy = true; publish({ phase: 'downloading', error: undefined, received: 0, total: undefined });
  try {
    await candidate.download(event => {
      if (event.event === 'Started') publish({ total: event.data.contentLength });
      if (event.event === 'Progress') publish({ received: snapshot.received + event.data.chunkLength });
    });
    // Promise resolves only after the updater's mandatory signature verification.
    publish({ phase: 'downloaded', downloaded: true });
  } catch (error) { publish({ phase: 'error', downloaded: false, error: `下载或签名验证失败，未执行安装：${String(error)}` }); }
  finally { busy = false; }
}
export async function installUpdate() {
  if (busy || !candidate || !snapshot.downloaded) return;
  busy = true; publish({ phase: 'installing', error: undefined });
  const wasInert = document.body.inert;
  document.body.inert = true; // Do not allow new editor input between flush and exit.
  try {
    await flushPendingSaves(); // Any unresolved save/conflict cancels installation.
    await candidate.install(); // Windows updater exits the app and invokes signed NSIS.
    publish({ phase: 'downloaded', error: '安装程序已启动；如软件未退出，请按安装程序提示操作。' });
  } catch (error) { publish({ phase: 'error', error: `未完成安装：${String(error)}。请先处理保存问题再重试。` }); }
  finally { document.body.inert = wasInert; busy = false; }
}
