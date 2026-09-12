import { useState, useSyncExternalStore } from 'react';
import { checkForUpdates, downloadUpdate, installUpdate, openReleases, subscribeUpdates, updateSnapshot } from '../../platform/updater';
import { Panel, Button } from '../../shared/ui';

export function UpdateSettings({ currentVersion }: { currentVersion?: string }) {
  const state = useSyncExternalStore(subscribeUpdates, updateSnapshot, updateSnapshot);
  const [confirmed, setConfirmed] = useState(false);
  const [linkError, setLinkError] = useState('');
  const busy = ['checking', 'downloading', 'installing'].includes(state.phase);
  const bytes = (value: number) => `${(value / 1048576).toFixed(1)} MB`;
  return <Panel title="软件更新">
    <p>通过官方 GitHub Releases 获取更新，下载后校验签名，再由你确认安装。</p>
    {(state.current || currentVersion) && <p>当前版本：{state.current || currentVersion}</p>}
    <div className="settings-control-row">
      <Button disabled={busy} onClick={() => { setConfirmed(false); void checkForUpdates(); }}>{state.phase === 'checking' ? '正在检查…' : '检查更新'}</Button>
      <Button disabled={busy} onClick={() => { setLinkError(''); void openReleases().catch(error => setLinkError(String(error))); }}>官方发布页 / 浏览器插件</Button>
    </div>
    {state.phase === 'latest' && <p role="status">当前已是更新通道中的最新版本。</p>}
    {state.version && <p><strong>可更新至 {state.version}</strong></p>}
    {state.notes && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflow: 'auto', font: 'inherit' }}>{state.notes}</pre>}
    {state.version && !state.downloaded && <Button variant="primary" disabled={busy} onClick={() => void downloadUpdate()}>下载并验证更新</Button>}
    {state.phase === 'downloading' && <div role="status"><p>正在下载并校验：{bytes(state.received)}{state.total ? ` / ${bytes(state.total)}` : ''}</p><progress aria-label="更新下载进度" max={state.total || undefined} value={state.total ? state.received : undefined} /></div>}
    {state.downloaded && <>
      <p role="status">更新包已下载并通过签名校验。安装会关闭当前软件。</p>
      <label className="settings-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />我已备份重要资料，并同意保存笔记后退出软件安装更新。</label>
      <Button variant="primary" disabled={!confirmed || busy} onClick={() => { setConfirmed(false); void installUpdate(); }}>{state.phase === 'installing' ? '正在保存并启动安装…' : '保存并安装更新'}</Button>
    </>}
    {(state.error || linkError) && <p role="alert">{state.error || linkError}</p>}
    <p className="settings-muted">仅支持 Windows x64 更新；不会后台自动下载或强制重启。浏览器插件在弹窗底部“插件设置与更新”中检查新版、下载并按指引重新加载，也可从官方发布页获取。旧版首次升级到支持更新的版本仍需手动安装一次。</p>
  </Panel>;
}
