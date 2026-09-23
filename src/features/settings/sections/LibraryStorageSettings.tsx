import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';
import {
  LIBRARY_STORAGE_MIGRATION_EVENT,
  cancelLibraryFilesRootMigration,
  formatByteSize,
  getLibraryStorage,
  selectLibraryFilesRoot,
  setLibraryFilesRoot,
  validateLibraryFilesRoot,
  type LibraryStorageInfo,
  type LibraryStorageMigrationProgress,
} from '../../../platform/nativeApi';
import { Button } from '../../../shared/ui';
import { ActionRow, PathRow, SettingGroup, StatusLine } from '../primitives';

/** Where the large library files live (task 6557dc15): choose, migrate, reset, reveal. */
export function LibraryStorageSettings({ onChanged, onReveal }: {
  onChanged?: () => void | Promise<void>;
  onReveal?: () => void | Promise<void>;
}) {
  const [info, setInfo] = useState<LibraryStorageInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [migrate, setMigrate] = useState(true);
  const [progress, setProgress] = useState<LibraryStorageMigrationProgress | null>(null);
  const [status, setStatus] = useState<{ tone: 'success' | 'error' | 'busy'; message: string }>({ tone: 'success', message: '' });

  const refresh = useCallback(async () => {
    try {
      setInfo(await getLibraryStorage());
      setLoadError('');
    } catch (error) {
      setLoadError(String(error));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    let active = true;
    let unlisten: UnlistenFn | null = null;
    listen<LibraryStorageMigrationProgress>(LIBRARY_STORAGE_MIGRATION_EVENT, (event) => {
      if (active) setProgress(event.payload);
    }).then((stop) => {
      if (active) unlisten = stop; else stop();
    }).catch(() => { /* not running inside Tauri */ });
    return () => { active = false; unlisten?.(); };
  }, []);

  const copyPath = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus({ tone: 'success', message: '路径已复制。' });
    } catch {
      setStatus({ tone: 'error', message: '复制失败，请手动选择路径。' });
    }
  };

  const apply = async (path: string | null) => {
    setBusy(true);
    setProgress(null);
    setStatus({ tone: 'busy', message: migrate ? '正在迁移文件，请勿关闭应用…' : '正在保存存储位置…' });
    try {
      const report = await setLibraryFilesRoot(path, migrate);
      const warnings = report.warnings.length ? ` 提示：${report.warnings.join('；')}` : '';
      const message = report.filesMoved > 0
        ? `已把 ${report.filesMoved} 个文件（${formatByteSize(report.bytesMoved)}）迁移到 ${report.to}，数据库已更新 ${report.databaseRowsUpdated} 条记录。${warnings}`
        : path
          ? `新导入、采集与译文文件将保存到 ${report.to}。${migrate ? '' : ' 已有文件保留在原位置。'}${warnings}`
          : `已恢复默认位置 ${report.to}。${warnings}`;
      setStatus({ tone: 'success', message: `${message} 浏览器采集缓存位置在下次启动后切换。` });
      await refresh();
      await onChanged?.();
    } catch (error) {
      setStatus({ tone: 'error', message: String(error) });
      await refresh();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const choose = async () => {
    let selected: string | null = null;
    try {
      selected = await selectLibraryFilesRoot(info?.recommendedRoot ?? info?.filesRoot ?? undefined);
    } catch (error) {
      setStatus({ tone: 'error', message: `无法打开文件夹选择器：${String(error)}` });
      return;
    }
    if (!selected) return;
    try {
      const candidate = await validateLibraryFilesRoot(selected);
      await apply(candidate.path);
    } catch (error) {
      setStatus({ tone: 'error', message: String(error) });
    }
  };

  const percent = progress && progress.totalBytes > 0
    ? Math.min(100, Math.round((progress.copiedBytes / progress.totalBytes) * 100))
    : progress && progress.totalFiles > 0
      ? Math.min(100, Math.round((progress.copiedFiles / progress.totalFiles) * 100))
      : 0;
  const phaseLabel = progress
    ? progress.phase === 'copying'
      ? `复制中 ${progress.copiedFiles}/${progress.totalFiles} 个文件（${formatByteSize(progress.copiedBytes)} / ${formatByteSize(progress.totalBytes)}）`
      : progress.phase === 'database'
        ? '正在更新数据库中的文件路径…'
        : progress.phase === 'cleanup'
          ? '正在清理旧位置…'
          : '完成'
    : '';
  const facts = info
    ? [
      info.isCustom ? '自定义位置' : '默认位置',
      info.onSystemDrive === true ? '位于系统盘' : info.onSystemDrive === false ? '不在系统盘' : null,
      `已占用 ${formatByteSize(info.filesSizeBytes)}`,
      info.freeBytes !== null ? `所在磁盘剩余 ${formatByteSize(info.freeBytes)}${info.totalBytes !== null ? ` / ${formatByteSize(info.totalBytes)}` : ''}` : null,
    ].filter(Boolean).join(' · ')
    : loadError ? '存储信息暂不可用。' : '正在读取…';
  const showRecommendation = Boolean(info && !info.isCustom && info.recommendedRoot);

  return (
    <SettingGroup
      title="文件存储位置"
      description="原文 PDF、浏览器采集的 PDF、译文 PDF 与附件的保存目录；数据库、备份与配置仍留在资料库根目录。"
      anchorId="storage"
    >
      <div className="settings-paths" id="setting-library-storage" data-custom={info?.isCustom ? 'true' : 'false'} data-system-drive={info?.onSystemDrive === null || info?.onSystemDrive === undefined ? 'unknown' : String(info.onSystemDrive)}>
        <PathRow id="setting-library-storage-root" label="文件目录" value={info?.filesRoot ?? (loadError ? '不可用' : '…')} onCopy={copyPath} />
        <p className="settings-muted" id="setting-library-storage-facts">{facts}</p>
        {showRecommendation && info ? (
          <p className="settings-storage-recommend" id="setting-library-storage-recommend">
            建议改到 <code>{info.recommendedRoot}</code>{info.onSystemDrive ? '，避免 PDF 与译文占满系统盘' : ''}。
          </p>
        ) : null}
      </div>
      <label className="settings-storage-migrate" htmlFor="setting-library-storage-migrate">
        <input id="setting-library-storage-migrate" type="checkbox" checked={migrate} disabled={busy} onChange={(event) => setMigrate(event.target.checked)} />
        <span>同时迁移现有文件到新位置（先复制并校验，成功后再删除旧文件）</span>
      </label>
      <ActionRow>
        <Button id="setting-library-storage-choose" variant="primary" disabled={busy} onClick={() => void choose()}>选择目录…</Button>
        {showRecommendation && info ? (
          <Button id="setting-library-storage-use-recommended" disabled={busy} onClick={() => void apply(info.recommendedRoot)}>使用推荐位置</Button>
        ) : null}
        {info?.isCustom ? (
          <Button id="setting-library-storage-reset" disabled={busy} onClick={() => void apply(null)}>恢复默认位置</Button>
        ) : null}
        <Button id="setting-library-storage-open" disabled={busy || !info} onClick={() => void onReveal?.()}>打开所在文件夹</Button>
        {busy && progress?.phase === 'copying' ? (
          <Button id="setting-library-storage-cancel" danger onClick={() => void cancelLibraryFilesRootMigration()}>取消迁移</Button>
        ) : null}
      </ActionRow>
      {busy && progress ? (
        <div className="settings-storage-progress" id="setting-library-storage-progress">
          <div className="settings-storage-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="迁移进度">
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="settings-muted">{phaseLabel}{progress.current ? ` · ${progress.current}` : ''}</span>
        </div>
      ) : null}
      <StatusLine id="library-storage-status" tone={status.tone} message={status.message || (loadError && !info ? loadError : '')} />
    </SettingGroup>
  );
}
