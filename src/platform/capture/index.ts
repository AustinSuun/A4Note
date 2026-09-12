import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke, isTauri } from '@tauri-apps/api/core';
export interface CaptureTaskSummary {
  captureId: string;
  title: string;
  state: string;
  updatedAt: number;
  result: { libraryImported?: boolean; libraryError?: string; library?: { paperId: string; hasSourcePdf: boolean }; error?: string; artifacts?: Array<{ id: string; state: string; error?: string; storedPath?: string }> };
}
export interface CaptureBridgeStatus {
  enabled: boolean;
  transport?: string;
  error?: string;
  enrichMetadata?: boolean;
  inbox: { tasks: CaptureTaskSummary[] };
}
export const captureSupported = () => isTauri();
const control = <T>(action: string, fields: Record<string, string | boolean> = {}): Promise<T> => {
  if (!isTauri()) return Promise.reject(new Error('请在 A4 Note 桌面软件中使用采集服务'));
  return invoke<T>('capture_control', { request: { action, ...fields } });
};
export const getCaptureStatus = () => control<CaptureBridgeStatus>('status');
export const disableCaptureBridge = () => control<{ enabled: boolean }>('disable');
export const revealCaptureInbox = () => control('reveal');
export const updateCaptureTask = (captureId: string, action: 'retry' | 'cancel') => control(action, { captureId });

export interface PaperCaptureDetailsData {
  snapshots: Array<{ captureId: string; envelope: { origin?: string; sourceUrl?: string; metadata?: { abstract?: string; dates?: { online?: string } } } }>;
  files: Array<{ id: string; kind: string; name: string }>;
}
export const getPaperCaptureDetails = (paperId: string) => control<PaperCaptureDetailsData>('paper_details', { paperId });
export const openCapturedPaperFile = (paperId: string, fileId: string) => control('open_library_file', { paperId, fileId });
export async function attachPaperPdf(paperId: string) {
  const localPath = await open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!localPath || Array.isArray(localPath)) return null;
  return control('attach_pdf', { paperId, localPath });
}
export async function subscribeCaptureLibraryChanges(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  return listen('capture://library-changed', handler);
}


export const setCaptureEnrichment = (enrichMetadata: boolean) => control('preferences', { enrichMetadata });
