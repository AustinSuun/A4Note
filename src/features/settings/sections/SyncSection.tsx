import { useState } from 'react';
import { Button } from '../../../shared/ui';
import { ActionRow, EmptyState, SettingField, SettingGroup, StatusLine } from '../primitives';
import type { SyncSettingsState } from '../types';
import { useAsyncStatus } from '../useAsyncStatus';

export function SyncSection({ sync, onSync, onSyncLogin, onSyncLogout }: {
  sync: SyncSettingsState;
  onSync: () => void | Promise<void>;
  onSyncLogin: (username: string, password: string) => void | Promise<void>;
  onSyncLogout: () => void | Promise<void>;
}) {
  const status = useAsyncStatus();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const busy = status.busy || Boolean(sync.busy);
  if (!sync.supported) {
    return <SettingGroup title="多端同步" anchorId="sync"><EmptyState title="当前环境不支持桌面端同步" description="同步需要桌面版应用；浏览器预览下无法登录或手动同步。" /></SettingGroup>;
  }
  return (
    <>
      <SettingGroup title="账号" description="同步笔记内容；PDF 与本地文件保持设备隔离。" anchorId="account">
        {sync.authenticated ? (
          <>
            <SettingField id="setting-sync-account" label="同步账号" description="已登录，可手动触发同步或退出登录。">
              <span className="settings-value-static">{sync.username || '已登录'}</span>
            </SettingField>
            <ActionRow>
              <Button id="setting-sync-actions" variant="primary" disabled={busy} onClick={() => void status.run(() => onSync(), { busy: '正在同步…', success: () => '同步已完成。', error: () => sync.lastError ?? '同步失败，请稍后重试。' })}>{busy ? '正在同步…' : '立即同步'}</Button>
              <Button id="setting-sync-logout" disabled={busy} onClick={() => void status.run(() => onSyncLogout(), { busy: '正在退出登录…', success: () => '已退出同步账号。', error: () => '退出登录失败。' })}>退出登录</Button>
            </ActionRow>
          </>
        ) : (
          <form className="settings-sync-login" onSubmit={(event) => { event.preventDefault(); void status.run(() => onSyncLogin(username, password), { busy: '正在登录…', success: () => '已登录同步服务。', error: (error) => (error instanceof Error && error.message) || '登录失败，请检查账号与密码。' }); }}>
            <SettingField id="setting-sync-account" label="账号" description="用于登录同步服务的用户名。" mode="label">
              <input value={username} autoComplete="username" onChange={(event) => setUsername(event.target.value)} />
            </SettingField>
            <SettingField id="setting-sync-password" label="密码" description="凭据只保存在本机。" mode="label">
              <input type="password" value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
            </SettingField>
            <ActionRow>
              <Button variant="primary" type="submit" disabled={busy}>{busy ? '正在登录…' : '登录同步服务'}</Button>
            </ActionRow>
          </form>
        )}
      </SettingGroup>
      <SettingGroup title="同步状态" description="待处理操作、最近一次成功时间与错误都会在这里显示。" anchorId="status">
        <div className="settings-detail-grid" id="setting-sync-status">
          <DiagnosticRow label="状态" value={busy ? '同步中' : sync.authenticated ? '已登录' : '未登录'} />
          <DiagnosticRow label="待处理操作" value={String(sync.pendingOperations)} />
          <DiagnosticRow label="最近成功" value={sync.lastSuccessAt ?? '暂无记录'} />
        </div>
        {sync.lastError ? <StatusLine id="sync-last-error" tone="error" message={`上次同步失败：${sync.lastError}`} /> : null}
        <StatusLine id="sync-status" tone={status.status.tone === 'error' ? 'error' : status.status.tone === 'busy' ? 'busy' : 'success'} message={sync.lastError && status.status.tone === 'idle' ? '' : status.status.message} />
        {sync.pendingOperations > 0 ? <p className="settings-muted">还有 {sync.pendingOperations} 个操作等待上传，联网后会自动继续。</p> : null}
      </SettingGroup>
    </>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return <div className="diagnostics-item"><span>{label}</span><code title={value}>{value}</code></div>;
}
