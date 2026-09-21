// Environment strip shown at the bottom of every development / test entry point.
//
// The strip never asserts isolation on its own: inside a Tauri window it asks the
// native side (`get_dev_environment`) and only says "独立测试库" when the backend
// proved identity + data root + WebView profile. In a plain browser (Vite dev
// server without Tauri) it says so. Release builds get the `release` verdict and
// render nothing, so the production app is never labelled.
//
// Dependency-free on purpose: it is installed before React mounts, so the strip
// exists even when the product bundle fails, and it never imports product modules.

export const DEV_STRIP_ID = 'a4note-live-dev-badge';
export const DEV_STRIP_HEIGHT = 28;

export type DevEnvironmentMode = 'release' | 'production-debug' | 'isolated' | 'blocked';
export type DevEnvironmentVerdict = {
  mode: DevEnvironmentMode;
  identifier: string;
  instance: string | null;
  debug: boolean;
  isolated: boolean;
  blocked: boolean;
  code?: string | null;
  reason?: string | null;
  dataRootTail?: string;
  productName?: string;
  version?: string;
};
export type DevStripState = 'checking' | 'browser' | 'verified' | 'production' | 'unverified' | 'blocked' | 'error';

export type DevStripOptions = {
  /** Launcher instance name when served by `npm run dev:live`; `preview` for plain `npm run dev`. */
  instance?: string | null;
  /** Identity the launcher expects; a different native identity is treated as a mixed-up entry point. */
  expected?: string | null;
  /** True under the Vite dev server (`import.meta.env.DEV`). Static bundles pass false. */
  dev?: boolean;
};

type TauriInternals = { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };

const STYLE = (id: string, height: number) =>
  `:root[data-a4note-env-strip] body{padding-bottom:${height}px!important;box-sizing:border-box!important}` +
  `#${id}{position:fixed;left:0;right:0;bottom:0;height:${height}px;box-sizing:border-box;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:0 10px;` +
  `background:#153f37;color:#fff;border-top:1px solid #82c2ad;font:12px/1 system-ui,'Segoe UI',sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}` +
  `#${id}[data-state=checking]{background:#2b3f4a;border-top-color:#8fb7c9}` +
  `#${id}[data-state=browser]{background:#3f3a1f;border-top-color:#d6c46b}` +
  `#${id}[data-state=unverified]{background:#5a3f10;border-top-color:#f0b95a}` +
  `#${id}[data-state=production]{background:#7a3d00;border-top-color:#ffb36b}` +
  `#${id}[data-state=blocked],#${id}[data-state=error]{background:#7a1f1f;border-top-color:#f0a3a3;pointer-events:auto;user-select:text;white-space:normal;line-height:1.2}` +
  `#${id} b{font-weight:700;letter-spacing:.04em}`;

function readVerdict(value: unknown): DevEnvironmentVerdict {
  if (!value || typeof value !== 'object') throw new Error('empty verdict');
  const env = value as Partial<DevEnvironmentVerdict>;
  if (typeof env.mode !== 'string' || typeof env.identifier !== 'string') throw new Error('malformed verdict');
  return env as DevEnvironmentVerdict;
}

/** Installs the strip once; safe to call before the React root exists. */
export function installDevEnvironmentStrip({ instance = null, expected = null, dev = false }: DevStripOptions = {}): void {
  if (typeof document === 'undefined' || document.getElementById(DEV_STRIP_ID)) return;
  const tauri = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  const label = instance ?? 'preview';
  let badge: HTMLDivElement | null = null;
  const ensure = () => {
    if (badge) return badge;
    const style = document.createElement('style');
    style.textContent = STYLE(DEV_STRIP_ID, DEV_STRIP_HEIGHT);
    document.head.append(style);
    badge = document.createElement('div');
    badge.id = DEV_STRIP_ID;
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    document.documentElement.dataset.a4noteEnvStrip = '1';
    document.body.append(badge);
    return badge;
  };
  const set = (state: DevStripState, text: string) => {
    const node = ensure();
    node.dataset.state = state;
    node.replaceChildren();
    const tag = document.createElement('b');
    tag.textContent = state === 'production' ? 'DEV·正式库' : 'DEV';
    node.append(tag, document.createTextNode(' ' + text));
    node.title = tag.textContent + ' ' + text;
  };
  const lock = () => {
    const root = document.getElementById('root');
    if (!root) return;
    root.inert = true;
    root.setAttribute('aria-hidden', 'true');
    root.dataset.a4noteDevBlocked = 'true';
  };
  if (!tauri || typeof tauri.invoke !== 'function') {
    // No native side at all: only the Vite dev server is a legitimate reason to be here.
    if (dev) set('browser', label + ' · 浏览器预览 · 无原生资料库（不能作为隔离/持久化验收）');
    return;
  }
  // A launcher-managed page is expected to answer quickly; static bundles show nothing until the verdict arrives.
  if (dev || expected) set('checking', label + ' · 原生隔离核验中…');
  Promise.resolve()
    .then(() => tauri.invoke!('get_dev_environment'))
    .then((value) => {
      const env = readVerdict(value);
      const name = env.instance || label;
      if (env.mode === 'blocked') {
        set('blocked', name + ' · 已阻止资料库访问 · ' + (env.reason || env.code || '未知原因'));
        lock();
        return;
      }
      if (expected && env.identifier !== expected) {
        set('blocked', name + ' · 前端实例 ' + label + ' 与原生身份 ' + env.identifier + ' 不一致 · 已停止测试');
        lock();
        return;
      }
      if (env.mode === 'isolated') {
        document.documentElement.dataset.a4noteDevInstance = env.identifier;
        set('verified', name + ' · 独立测试库（原生已核验 ' + (env.dataRootTail ?? '') + '）· ' + env.identifier + (env.debug ? '' : ' · release'));
        return;
      }
      if (env.mode === 'production-debug') {
        set('production', '正式资料库 · 已按 A4NOTE_ALLOW_PRODUCTION_LIBRARY 明确放行 · 非隔离测试环境');
        return;
      }
      if (env.mode === 'release') {
        // The shipped product: no strip. Under a dev server a release binary is still worth flagging.
        if (dev) set('unverified', name + ' · 发布构建连接了开发服务器 · 隔离未核验');
        else badge?.remove();
        return;
      }
      set('unverified', name + ' · 隔离未核验（' + String(env.mode) + '）');
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      set('error', label + ' · 原生隔离核验失败 · ' + message.slice(0, 200) + ' · 请停止测试并检查启动入口');
      // Fail closed only where a launcher or dev server is involved; a static bundle keeps the native gate as its guard.
      if (dev || expected) lock();
    });
}
