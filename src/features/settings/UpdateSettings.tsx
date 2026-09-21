import { useState } from 'react';
import { updateActions, useUpdateModel } from './updateModel';
import { UpdateConsent, UpdateNotes, UpdateProgress } from './updateViews';
import { ActionRow, SettingGroup, StatusLine } from './primitives';
import { Button } from '../../shared/ui';

/* Full-page shape of the shared update flow (see updateModel.ts). */
export function UpdateSettings({ currentVersion }: { currentVersion?: string }) {
  const model = useUpdateModel(currentVersion);
  const [confirmed, setConfirmed] = useState(false);
  const [linkError, setLinkError] = useState('');
  const busy = model.busy;
  return (
    <>
      <SettingGroup title="检查更新" description="通过官方 GitHub Releases 获取更新，下载后校验签名，再由你确认安装。" anchorId="check" actions={<span className="settings-muted">{model.current ? `当前版本：${model.current}` : ''}</span>}>
        <ActionRow>
          <Button id="setting-update-check" disabled={busy} onClick={() => { setConfirmed(false); void updateActions.check(); }}>{model.checkLabel}</Button>
          <Button id="setting-update-release-page" disabled={busy} onClick={() => { setLinkError(''); void updateActions.openReleases().catch((error) => setLinkError(String(error))); }}>官方发布页 / 浏览器插件</Button>
        </ActionRow>
        {model.phaseMessage ? <StatusLine id="update-phase" tone={model.phase === 'latest' ? 'success' : 'busy'} message={model.phaseMessage} /> : null}
        {model.version ? <p className="settings-update-version">可更新至 <strong>{model.version}</strong></p> : null}
      </SettingGroup>
      {model.version ? (
        <SettingGroup title="发行说明" description="来自候选版本的发布说明，最多展示前若干条。" anchorId="notes">
          <div id="setting-update-notes">
            <UpdateNotes notes={model.notes} limitLines={8} />
            {!model.notes.hasAny ? <p className="settings-muted">该版本没有提供发布说明。</p> : null}
          </div>
        </SettingGroup>
      ) : null}
      {model.version ? (
        <SettingGroup title="下载与安装" description={model.manualInstallHint} anchorId="install">
          {model.canDownload ? <ActionRow><Button id="setting-update-download" variant="primary" disabled={busy} onClick={() => void updateActions.download()}>下载并验证更新</Button></ActionRow> : null}
          {model.phase === 'downloading' ? <UpdateProgress model={model} /> : null}
          {model.downloaded ? (
            <>
              <StatusLine id="update-downloaded" tone="success" message="更新包已下载并通过签名校验。安装会关闭当前软件。" />
              {model.backupPath ? <p className="settings-muted settings-path-ellipsis" title={model.backupPath}>本次资料库备份：{model.backupPath}</p> : null}
              <UpdateConsent checked={confirmed} disabled={busy} onChange={setConfirmed} />
              <ActionRow>
                <Button id="setting-update-install" variant="primary" disabled={!confirmed || busy} onClick={() => { setConfirmed(false); void updateActions.install(); }}>{model.installLabel}</Button>
              </ActionRow>
            </>
          ) : null}
        </SettingGroup>
      ) : null}
      {model.error || linkError ? <StatusLine id="update-error" tone="error" message={model.error || linkError} /> : null}
      <p className="settings-muted">仅支持 Windows x64 更新；不会后台自动下载或强制重启。浏览器插件在弹窗底部“插件设置与更新”中检查新版，也可从官方发布页获取。旧版首次升级到支持更新的版本仍需手动安装一次。</p>
    </>
  );
}
