import { useSyncExternalStore } from 'react';
import { checkForUpdates, downloadUpdate, installUpdate, openReleases, subscribeUpdates, updateSnapshot } from '../../platform/updater';

/* The Settings page and the titlebar menu are two shapes of one update flow.
   Both read this model; neither re-implements release notes, progress or labels. */
export type UpdatePhase = 'idle' | 'checking' | 'available' | 'latest' | 'downloading' | 'downloaded' | 'installing' | 'error';
export type ReleaseNotes = { items: string[]; reminders: string[]; truncated: boolean; hasAny: boolean };

export const RELEASE_NOTE_LIMIT = 1200;

const isReminder = (line: string) => /^(?:(?:重要|注意|提醒)[：:]|升级前.*备份)/.test(line);

/* Accepts both older semicolon-separated notes and plain-text bullet lists.
   Periods are never separators: version numbers and URLs must survive intact. */
export function parseReleaseNotes(text: string | undefined, limit = RELEASE_NOTE_LIMIT): ReleaseNotes {
  const raw = (text ?? '').trim();
  const lines = raw.slice(0, limit).split(/[\r\n；;。]+/)
    .map((line) => line.trim().replace(/^(?:[-*•]\s+|\d+[.)、]\s+)/, '').trim())
    .filter(Boolean);
  return {
    items: lines.filter((line) => !isReminder(line)),
    reminders: lines.filter(isReminder),
    truncated: raw.length > limit,
    hasAny: lines.length > 0,
  };
}

export function formatBytes(value: number): string {
  return `${(value / 1048576).toFixed(1)} MB`;
}

export type UpdateModel = {
  phase: UpdatePhase;
  busy: boolean;
  current: string;
  version?: string;
  notes: ReleaseNotes;
  received: number;
  total?: number;
  downloaded: boolean;
  installStep?: 'saving' | 'backing-up' | 'launching';
  backupPath?: string;
  error?: string;
  canCheck: boolean;
  canDownload: boolean;
  canInstall: boolean;
  progressPercent?: number;
  phaseMessage?: string;
  sizeLabel: string;
  checkLabel: string;
  installLabel: string;
  manualInstallHint: string;
};

export function buildUpdateModel(state: ReturnType<typeof updateSnapshot>, currentVersion?: string): UpdateModel {
  const busy = ['checking', 'downloading', 'installing'].includes(state.phase);
  const receivedLabel = formatBytes(state.received);
  const sizeLabel = state.total ? `${receivedLabel} / ${formatBytes(state.total)}` : receivedLabel;
  return {
    phase: state.phase as UpdatePhase,
    busy,
    current: state.current || currentVersion || '',
    version: state.version,
    notes: parseReleaseNotes(state.notes),
    received: state.received,
    total: state.total,
    downloaded: state.downloaded,
    installStep: state.installStep,
    backupPath: state.backupPath,
    error: state.error,
    canCheck: !busy,
    canDownload: !busy && Boolean(state.version) && !state.downloaded,
    canInstall: !busy && state.downloaded,
    progressPercent: state.total ? Math.min(100, Math.round((state.received / state.total) * 100)) : undefined,
    phaseMessage: state.phase === 'latest' ? '当前已是更新通道中的最新版本。' : state.phase === 'checking' ? '正在检查更新…' : undefined,
    sizeLabel,
    checkLabel: state.phase === 'checking' ? '正在检查…' : '检查更新',
    installLabel: state.phase !== 'installing' ? '备份并安装更新' : state.installStep === 'backing-up' ? '正在备份资料库…' : state.installStep === 'saving' ? '正在保存…' : '正在启动安装…',
    manualInstallHint: '安装前自动备份资料库数据库和库内附件；不含外部 Markdown 笔记文件夹，请自行备份。备份失败将停止安装。',
  };
}

export function useUpdateModel(currentVersion?: string): UpdateModel {
  const state = useSyncExternalStore(subscribeUpdates, updateSnapshot, updateSnapshot);
  return buildUpdateModel(state, currentVersion);
}

/* Single source for the update verbs so both entry points behave identically. */
export const updateActions = {
  check: checkForUpdates,
  download: downloadUpdate,
  install: installUpdate,
  openReleases,
};
