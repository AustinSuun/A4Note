import type { SceneContribution } from '../../../core/types';
import type { AsterPaths, BackupResult } from '../../../platform/nativeApi';
import { Button } from '../../../shared/ui';
import { zh } from '../../../ui/zh';
import { CaptureSettings } from '../CaptureSettings';
import { LibraryStorageSettings } from './LibraryStorageSettings';
import { ActionRow, PathRow, SettingField, SettingGroup, StatusLine, ToggleRow } from '../primitives';
import type { SettingsPathKind } from '../types';
import { useAsyncStatus } from '../useAsyncStatus';

export function LibrarySection({ paths, onRefreshPaths, onRevealPath, onCreateBackup, onRestoreBackup, scenes, enabledSceneIds, onToggleScene }: {
  paths: AsterPaths | null;
  onRefreshPaths: () => void | Promise<void>;
  onRevealPath: (kind: SettingsPathKind) => void | Promise<void>;
  onCreateBackup: () => Promise<BackupResult>;
  onRestoreBackup: () => Promise<void>;
  scenes: SceneContribution[];
  enabledSceneIds: string[];
  onToggleScene: (sceneId: string, enabled: boolean) => void;
}) {
  const status = useAsyncStatus();
  const unavailable = zh.settings.pathUnavailable;
  const copyPath = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      status.set('success', zh.settings.pathCopied);
    } catch {
      status.set('error', zh.settings.pathCopyFailed);
    }
  };
  return (
    <>
      <SettingGroup
        title={zh.settings.library}
        description={zh.settings.localLibrary}
        anchorId="paths"
        actions={<Button size="compact" onClick={() => void status.run(() => onRefreshPaths(), { success: () => '路径已刷新。', error: () => zh.settings.pathUnavailable })}>刷新路径</Button>}
      >
        <div className="settings-paths" id="setting-library-paths">
          <PathRow id="setting-library-root" label={zh.settings.libraryRoot} value={paths?.root ?? unavailable} onCopy={copyPath} />
          <PathRow id="setting-library-database" label={zh.settings.databasePath} value={paths?.database ?? unavailable} onCopy={copyPath} />
          <PathRow id="setting-library-files" label={zh.settings.filesPath} value={paths?.files_root ?? unavailable} onCopy={copyPath} />
        </div>
        <ActionRow>
          <Button onClick={() => void onRevealPath('root')}>{zh.settings.openLibraryRoot}</Button>
          <Button onClick={() => void onRevealPath('files')}>{zh.settings.openFilesPath}</Button>
          <Button onClick={() => void onRevealPath('backups')}>{zh.settings.openBackupsPath}</Button>
        </ActionRow>
        <StatusLine id="library-path-status" tone={status.status.tone === 'error' ? 'error' : status.status.tone === 'busy' ? 'busy' : 'success'} message={status.status.tone === 'error' || status.status.tone === 'success' || status.status.tone === 'busy' ? status.status.message : ''} />
      </SettingGroup>
      <LibraryStorageSettings onChanged={onRefreshPaths} onReveal={() => onRevealPath('files')} />
      <SettingGroup title="备份与恢复" description="备份包含资料库数据库与库内附件，不含外部 Markdown 笔记文件夹。" anchorId="backup">
        <ActionRow>
          <Button id="setting-backup" variant="primary" pill disabled={status.busy} onClick={() => void status.run(() => onCreateBackup(), { busy: zh.settings.backupRunning, success: (result) => `${zh.settings.backupCreated}：${result.backup_path}`, error: () => zh.settings.backupFailed })}>{status.busy ? zh.settings.backupRunning : zh.settings.createBackup}</Button>
          <Button id="setting-restore" pill disabled={status.busy} onClick={() => void status.run(() => onRestoreBackup(), { busy: zh.settings.restoreRunning, success: () => zh.settings.restoreSuccess('（见上方状态）'), error: () => zh.settings.restoreFailed })}>{zh.settings.restoreBackup}</Button>
        </ActionRow>
        <StatusLine id="library-backup-status" tone={status.status.tone === 'error' ? 'error' : status.status.tone === 'busy' ? 'busy' : 'success'} message={status.status.message} />
      </SettingGroup>
      <SettingGroup title="浏览器论文采集" description="浏览器扩展与桌面软件的本地通信、采集任务与补全开关。" anchorId="capture">
        <div id="setting-capture"><CaptureSettings /></div>
      </SettingGroup>
      <SettingGroup title="工作台场景" description="场景决定左侧工作栏可以打开哪些视图。" anchorId="scenes">
        <div className="settings-toggle-list" id="setting-scenes">
          {scenes.length === 0 ? <p className="settings-muted">当前没有可用的场景插件。</p> : scenes.map((scene) => (
            <ToggleRow key={scene.id} id={`setting-scene-${scene.id}`} label={scene.label} checked={enabledSceneIds.includes(scene.id)} onChange={(checked) => onToggleScene(scene.id, checked)} />
          ))}
        </div>
      </SettingGroup>
    </>
  );
}
