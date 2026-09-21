import { useEffect, useMemo, useRef, useState } from 'react';
import { captureSupported, disableCaptureBridge, getCaptureStatus, revealCaptureInbox, updateCaptureTask, setCaptureEnrichment, type CaptureBridgeStatus } from '../../platform/capture';
import { Button } from '../../shared/ui';
import { ActionRow, EmptyState, SettingGroup, StatusLine, ToggleRow } from './primitives';

const labels: Record<string, string> = { queued: '排队', downloading: '下载中', browser_uploading: '浏览器传输中', complete: '文件已校验', needs_user: '需处理', partial: '部分完成', cancelled: '已取消', failed: '失败' };
const ACTIVE_STATES = ['queued', 'downloading', 'browser_uploading'];
const RETRY_STATES = ['partial', 'needs_user', 'failed', 'cancelled'];
/* The bridge returns up to 100 tasks. Rendering 100 rich rows at once is what this
   constant prevents: the list grows in pages, and every task stays reachable. */
const PAGE_SIZE = 8;

export function CaptureSettings() {
  const [bridge, setBridge] = useState<CaptureBridgeStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const mounted = useRef(true), pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      if (!captureSupported() || pending.current) return;
      void getCaptureStatus()
        .then((status) => { if (mounted.current) { setBridge(status); setError(''); } })
        .catch((cause) => { if (mounted.current) setError(String(cause)); })
        .finally(() => { if (mounted.current) setLoaded(true); });
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, []);
  const run = async (work: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage(''); setError('');
    try {
      await work();
      const next = await getCaptureStatus();
      if (mounted.current) { setBridge(next); setMessage('操作已提交，任务列表已刷新。'); }
    } catch (cause) {
      if (mounted.current) setError(String(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const tasks = bridge?.inbox.tasks ?? [];
  const summary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const task of tasks) counts[task.state] = (counts[task.state] ?? 0) + 1;
    return counts;
  }, [tasks]);
  const shown = tasks.slice(0, visible);
  const supported = captureSupported();
  return (
    <SettingGroup title="浏览器论文采集 · 原生通信" description="无需链接、端口、扩展 ID 或配对码。安装通信组件后，在扩展点击连接，并在桌面允许一次；授权会保存在本机，重启后自动恢复。" anchorId="capture-native">
      {!supported ? <EmptyState title="请在 Windows 桌面软件中使用" description="浏览器采集需要原生通信组件，浏览器预览模式不可用。" /> : (
        <>
          <StatusLine id="capture-bridge-status" tone={bridge?.error ? 'error' : bridge?.enabled ? 'success' : 'info'} message={bridge?.error ? bridge.error : bridge?.enabled ? '已授权，可自动连接。' : '尚未授权或已暂停，请在扩展点击连接。'} />
          <ToggleRow id="setting-capture-enrichment" label="通过 Crossref / Europe PMC 补全信息" description="开启后会发送 DOI / PMCID；关闭则只保留浏览器侧抓取的信息。" checked={bridge?.enrichMetadata ?? true} disabled={busy || !bridge || Boolean(bridge?.error)} onChange={(checked) => void run(() => setCaptureEnrichment(checked))} />
          <ActionRow>
            <Button disabled={busy || !bridge?.enabled} onClick={() => void run(disableCaptureBridge)}>撤销浏览器授权</Button>
            <Button disabled={busy} onClick={() => void run(async () => {})}>刷新任务</Button>
            <Button disabled={busy || Boolean(bridge?.error)} onClick={() => void run(revealCaptureInbox)}>打开采集目录</Button>
          </ActionRow>
          <StatusLine id="capture-action-status" tone={error ? 'error' : message ? 'success' : 'busy'} message={error || message || (busy ? '正在执行操作…' : '')} />
          <div className="settings-capture-summary" data-capture-total={tasks.length}>
            <span>最近 {tasks.length} 条任务</span>
            {Object.entries(summary).map(([state, count]) => <span key={state} className="settings-capture-chip">{labels[state] ?? state} {count}</span>)}
          </div>
          {!loaded ? <p className="settings-muted" role="status">正在读取采集任务…</p> : tasks.length === 0 ? (
            <EmptyState title="最近没有采集任务" description="在浏览器扩展里采集论文后，这里会显示入库进度与失败原因。" />
          ) : (
            <>
              <div className="settings-capture-list" data-capture-rendered={shown.length}>
                {shown.map((task) => (
                  <div key={task.captureId} className="plugin-setting-row settings-capture-row">
                    <span className="plugin-setting-text">
                      <strong>{task.title || '未命名论文'}</strong>
                      <small>{labels[task.state] ?? task.state} · {task.result.libraryImported ? (task.result.library?.hasSourcePdf ? '已入文献库' : '元数据已入库，缺正文') : '尚未入库'}</small>
                      {task.result.libraryError ? <small>{task.result.libraryError}</small> : null}
                      {task.result.error ? <small>{task.result.error}</small> : null}
                      {task.result.artifacts?.filter((artifact) => artifact.error).map((artifact) => <small key={artifact.id}>{artifact.id}: {artifact.error}</small>)}
                    </span>
                    {RETRY_STATES.includes(task.state) ? <Button disabled={busy} onClick={() => void run(() => updateCaptureTask(task.captureId, 'retry'))}>重试</Button> : null}
                    {ACTIVE_STATES.includes(task.state) ? <Button disabled={busy} onClick={() => void run(() => updateCaptureTask(task.captureId, 'cancel'))}>取消</Button> : null}
                  </div>
                ))}
              </div>
              <ActionRow>
                {shown.length < tasks.length ? <Button onClick={() => setVisible((current) => Math.min(tasks.length, current + PAGE_SIZE))}>显示更多（还有 {tasks.length - shown.length} 条）</Button> : null}
                {shown.length < tasks.length ? <Button onClick={() => setVisible(tasks.length)}>展开全部</Button> : null}
                {shown.length > PAGE_SIZE ? <Button onClick={() => setVisible(PAGE_SIZE)}>收起</Button> : null}
              </ActionRow>
              <p className="settings-muted" role="status">已显示 {shown.length} / {tasks.length} 条最近任务。</p>
            </>
          )}
          <p className="settings-muted">请使用包含原生通信组件的新安装包，裸 EXE 不会注册浏览器连接。已入库信息和 PDF 随资料库备份；未完成队列暂存目录仍需单独备份。</p>
        </>
      )}
    </SettingGroup>
  );
}
