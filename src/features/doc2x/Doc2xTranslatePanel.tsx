import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './doc2x-panel.css';
import type { PaperDocument } from '../../core/types.ts';
import { doc2xSettingIds } from '../../core/doc2xPlugin.ts';
import { getAsterPaths } from '../../platform/nativeApi.ts';
import {
  buildDoc2xAccountStatusRequest,
  buildDoc2xLoginRequest,
  buildDoc2xLogoutRequest,
  parseDoc2xJsonPayload,
  DOC2X_MIN_NODE_MAJOR,
  DOC2X_NODE_DOWNLOAD_URL,
  DOC2X_NPM_MIRROR_URL,
  normalizeDoc2xRegistry,
  type Doc2xCliStatus,
} from '../../platform/doc2x/doc2xCli.ts';
import {
  detectDoc2xCli,
  listenDoc2xLoginEvents,
  runDoc2xCommand,
  startDoc2xInstall,
  startDoc2xLogin,
} from '../../platform/doc2x/index.ts';
import {
  readDoc2xTranslateSettings,
} from './doc2xSettings.ts';
import { translatePaperWithDoc2x } from './doc2xEntry.ts';

export interface Doc2xPanelProps {
  paper: PaperDocument | null;
  papers: PaperDocument[];
  bulkSelectedPaperIds: string[];
  settingValues: Record<string, unknown>;
}

interface QueueEntry {
  paperId: string;
  title: string;
  state: 'pending' | 'running' | 'done' | 'failed';
  detail: string;
}

const MAX_LOG_LINES = 40;

/** Turns the CLI stdout into the fields the panel shows. */
function summarizeAccount(stdout: string): string {
  const payload = parseDoc2xJsonPayload(stdout);
  if (!payload) return stdout.trim().slice(0, 400) || '（无输出）';
  const quota = payload.quota ?? payload.remaining_quota ?? payload.credits;
  const plan = payload.plan ?? payload.subscription ?? payload.tier;
  const parts: string[] = [];
  if (typeof plan === 'string' || typeof plan === 'number') parts.push(`订阅/套餐：${plan}`);
  if (typeof quota === 'string' || typeof quota === 'number') parts.push(`剩余额度：${quota}`);
  const email = payload.email ?? payload.account ?? payload.user;
  if (typeof email === 'string') parts.push(`账号：${email}`);
  return parts.length ? parts.join(' · ') : JSON.stringify(payload).slice(0, 400);
}

/**
 * Library workbench panel for Doc2X. The CLI stays the only thing that touches
 * credentials: login runs `doc2x login` with the CLI's own loopback OAuth flow,
 * and this panel only renders the lines the CLI prints.
 */
export function Doc2xTranslatePanel({
  paper,
  papers,
  bulkSelectedPaperIds,
  settingValues,
}: Doc2xPanelProps) {
  const [cli, setCli] = useState<Doc2xCliStatus | null>(null);
  const [account, setAccount] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const filesRoot = useRef('');
  const installJobId = useRef<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [confirmInstall, setConfirmInstall] = useState(false);
  const [useMirror, setUseMirror] = useState(false);
  const [mirrorError, setMirrorError] = useState("");
  const resolution = useMemo(() => readDoc2xTranslateSettings(settingValues), [settingValues]);

  const append = useCallback((line: string) => {
    setLines((current) => [...current, line].slice(-MAX_LOG_LINES));
  }, []);

  const ensureRoot = useCallback(async () => {
    if (!filesRoot.current) {
      const paths = await getAsterPaths();
      filesRoot.current = paths.files_root ?? paths.root ?? '';
    }
    return filesRoot.current;
  }, []);

  const refreshCli = useCallback(async () => {
    const root = await ensureRoot();
    setCli(await detectDoc2xCli(root || '.'));
  }, [ensureRoot]);

const refreshAccount = useCallback(async () => {
  const root = await ensureRoot();
  const outcome = await runDoc2xCommand(buildDoc2xAccountStatusRequest(root || "."));
  let summary = "";
  if (outcome.kind === "success") {
    summary = summarizeAccount(outcome.receipt ? JSON.stringify(outcome.receipt.raw) : "");
  } else if (outcome.kind === "failed") {
    summary = outcome.failure.message;
  } else {
    summary = outcome.kind === "timeout" ? "查询账号超时，请重试。" : outcome.message;
  }
  setAccount(summary);
  return summary;
}, [ensureRoot]);

  useEffect(() => {
    void refreshCli();
  }, [refreshCli]);

  // One subscription covers both the login job and the translation job: the
  // Rust side funnels every run through the same `doc2x://event` channel.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;
    void listenDoc2xLoginEvents({
      onEvent: (event) => append(`[${event.stream}] ${event.line}`),
      onExit: (exit) => {
        append(`[exit] status=${exit.status ?? "killed"} timedOut=${exit.timedOut}`);
        if (exit.jobId === installJobId.current) {
          installJobId.current = null;
          setInstalling(false);
          void refreshCli();
        }
      },
    }).then((dispose) => {
      if (!alive) {
        dispose();
        return;
      }
      unlisten = dispose;
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [append, refreshCli]);

const login = useCallback(async () => {
  setLoginBusy(true);
  setMessage("");
  let note = "";
  try {
    const root = await ensureRoot();
    const jobId = await startDoc2xLogin(buildDoc2xLoginRequest(root || "."));
    note = `已启动登录任务 ${jobId}，请在弹出的浏览器中授权你的 Doc2X 账号。`;
    append(note);
  } catch (error) {
    note = `启动登录失败：${error instanceof Error ? error.message : String(error)}`;
    setMessage(note);
  } finally {
    setLoginBusy(false);
  }
  return note;
}, [append, ensureRoot]);

const logout = useCallback(async () => {
  const root = await ensureRoot();
  const outcome = await runDoc2xCommand(buildDoc2xLogoutRequest(root || "."));
  const summary =
    outcome.kind === "success"
      ? "未登录"
      : outcome.kind === "failed"
        ? outcome.failure.message
        : "退出登录失败，请重试。";
  setAccount(summary);
  return summary;
}, [ensureRoot]);

  /** Node decides whether the one-click install can run at all. */
  const nodeReady = cli ? cli.nodeMajor !== null && cli.nodeMajor >= DOC2X_MIN_NODE_MAJOR : false;

  const installCli = useCallback(async () => {
    const root = await ensureRoot();
    const { registry, error } = normalizeDoc2xRegistry(useMirror ? DOC2X_NPM_MIRROR_URL : undefined);
    setMirrorError(error ?? '');
    if (error) return;
    setInstalling(true);
    setConfirmInstall(false);
    try {
      const jobId = await startDoc2xInstall({ cwd: root || '.', registry: registry ?? undefined });
      installJobId.current = jobId;
      append(`已开始安装 Doc2X CLI（任务 ${jobId}），全局安装可能需要几分钟。`);
    } catch (error) {
      setInstalling(false);
      setMessage(`安装启动失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [append, ensureRoot, useMirror]);

  const runOne = useCallback(
    async (target: PaperDocument): Promise<string> => {
      const root = await ensureRoot();
      // One implementation for the panel and the library entries.
      return translatePaperWithDoc2x(target, resolution.settings, root);
    },
    [ensureRoot, resolution.settings],
  );

  const startQueue = useCallback(
    async (targets: PaperDocument[]) => {
      if (!targets.length) {
        setMessage('没有可翻译的文献。');
        return;
      }
      setBusy(true);
      setMessage('');
      setQueue(
        targets.map((target) => ({
          paperId: target.paperId,
          title: target.title,
          state: 'pending',
          detail: '',
        })),
      );
      let failed = 0;
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        setQueue((current) =>
          current.map((entry, position) =>
            position === index ? { ...entry, state: 'running', detail: '翻译中…' } : entry,
          ),
        );
        try {
          const detail = await runOne(target);
          const ok = detail.startsWith('译文已回到该文献');
          if (!ok) failed += 1;
          setQueue((current) =>
            current.map((entry, position) =>
              position === index ? { ...entry, state: ok ? 'done' : 'failed', detail } : entry,
            ),
          );
        } catch (error) {
          failed += 1;
          const detail = error instanceof Error ? error.message : String(error);
          setQueue((current) =>
            current.map((entry, position) =>
              position === index ? { ...entry, state: 'failed', detail } : entry,
            ),
          );
        }
      }
      setBusy(false);
      setMessage(
        failed === 0
          ? `已完成 ${targets.length} 篇翻译。`
          : `批量翻译结束：成功 ${targets.length - failed} 篇，失败 ${failed} 篇（详见下方列表）。`,
      );
    },
    [runOne],
  );

  const selected = useMemo(
    () => papers.filter((entry) => bulkSelectedPaperIds.includes(entry.paperId)),
    [papers, bulkSelectedPaperIds],
  );
  const targets = selected.length ? selected : paper ? [paper] : [];

  // The Doc2X commands are installed by `Doc2xCommandHost` at the app root, so
  // they work before this panel has ever been opened. The panel keeps its own
  // controls below.

  return (
    <section className="doc2x-panel" aria-label="Doc2X 翻译">
      <header className="doc2x-panel__head">
        <h3>Doc2X 翻译</h3>
        <span className={`doc2x-panel__badge doc2x-panel__badge--${cli?.available ? 'ok' : 'warn'}`}>
          {cli ? (cli.available ? `CLI ${cli.version || '已安装'}` : '未检测到 CLI') : '检测中…'}
        </span>
      </header>

      {cli && !cli.available ? (
        <p className="doc2x-panel__hint">
          {cli.message}
          <br />
          安装：<code>npm i -g @noedgeai-org/doc2x-cli</code>（需要 Node.js 22 及以上），然后用
          <code> doc2x login</code> 登录你自己的账号。软件不会代你安装或代你登录。
        </p>
      ) : null}

      {cli && !cli.available ? (
        <div className="doc2x-panel__install">
          <p className="doc2x-panel__hint">{cli.message}</p>
          {!nodeReady ? (
            <p className="doc2x-panel__hint">
              Node.js 下载：<code>{DOC2X_NODE_DOWNLOAD_URL}</code>
            </p>
          ) : null}
          <label className="doc2x-panel__mirror">
            <input
              type="checkbox"
              checked={useMirror}
              onChange={(event) => setUseMirror(event.target.checked)}
              disabled={installing}
            />
            使用国内 npm 镜像安装（registry.npmmirror.com）
          </label>
          {mirrorError ? <p className="doc2x-panel__error">{mirrorError}</p> : null}
          {confirmInstall ? (
            <div className="doc2x-panel__row">
              <span>
                将在本机执行 <code>npm i -g @noedgeai-org/doc2x-cli</code>
                （全局安装，需要几分钟）。确认安装？
              </span>
              <button type="button" onClick={() => void installCli()} disabled={installing}>
                确认安装
              </button>
              <button
                type="button"
                onClick={() => setConfirmInstall(false)}
                disabled={installing}
              >
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmInstall(true)}
              disabled={installing || !nodeReady}
              title={nodeReady ? '' : '需要先安装 Node.js 22 或更高版本'}
            >
              {installing ? '安装中…' : '安装 Doc2X CLI'}
            </button>
          )}
        </div>
      ) : null}

      <div className="doc2x-panel__row">
        <button type="button" onClick={() => void refreshCli()} disabled={busy}>
          重新检测 CLI
        </button>
        <button type="button" onClick={() => void refreshAccount()} disabled={busy || loginBusy}>
          查询额度/订阅
        </button>
        <button type="button" onClick={() => void login()} disabled={busy || loginBusy}>
          {loginBusy ? '等待授权…' : '登录自有账号'}
        </button>
        <button type="button" onClick={() => void logout()} disabled={busy || loginBusy}>
          退出登录
        </button>
      </div>
      {account ? <p className="doc2x-panel__account">{account}</p> : null}

      <div className="doc2x-panel__row">
        <button
          type="button"
          className="doc2x-panel__primary"
          onClick={() => void startQueue(targets)}
          disabled={busy || !resolution.enabled}
        >
          {selected.length ? `翻译选中文献（${selected.length}）` : '翻译当前文献'}
        </button>
      </div>
      {!resolution.enabled ? (
        <p className="doc2x-panel__hint">已在设置中关闭 Doc2X 翻译入口。</p>
      ) : null}
      {resolution.errors.map((error) => (
        <p key={error} className="doc2x-panel__error">
          {error}
        </p>
      ))}
      {resolution.notices.map((notice) => (
        <p key={notice} className="doc2x-panel__hint">
          {notice}
        </p>
      ))}

      {queue.length ? (
        <ol className="doc2x-panel__queue">
          {queue.map((entry) => (
            <li key={entry.paperId} data-state={entry.state}>
              <span className="doc2x-panel__queue-title">{entry.title}</span>
              <span className="doc2x-panel__queue-detail">{entry.detail}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {message ? <p className="doc2x-panel__message">{message}</p> : null}

      <details className="doc2x-panel__log">
        <summary>CLI 输出（{lines.length} 行）</summary>
        <pre>
          <code>{lines.join('\n')}</code>
        </pre>
      </details>

      <p className="doc2x-panel__hint">
        文献列表右键菜单与文献详情面板也有「Doc2X 翻译」入口，不打开本面板也能直接发起。
      </p>

      <p className="doc2x-panel__hint">
        译文写入应用数据区 <code>translations/&lt;文献ID&gt;/&lt;runId&gt;/</code>，并作为该文献的译文绑定，
        不会新建文献条目，原 PDF、标注与笔记保持不变。
      </p>
    </section>
  );
}

export const doc2xPanelSettingIds = doc2xSettingIds;

