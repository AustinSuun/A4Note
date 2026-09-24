import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { Annotation, AnnotationLayer, AnnotationLayerDeletePreview, AnnotationLayerKind, AnnotationLayerOwnerKind, AnnotationLayerState, AnnotationType, ImportDraft, LibraryFolder, PaperDocument, PositionJson } from '../core/types';

/** Deterministic default layer id (mirrors the native migration); kept local so this module stays type-only towards core. */
const defaultAnnotationLayerId = (ownerId: string) => `layer-default-${ownerId}`;

const FALLBACK_TAG = '未分类';

export interface AsterPaths {
  root: string;
  database: string;
  files_root: string;
}

export interface BackupResult {
  backup_path: string;
}

export interface RestoreBackupResult {
  restored_from: string;
  safety_backup_path: string;
  restart_required: boolean;
}

export interface AppDiagnostics {
  product_name: string;
  version: string;
  identifier: string;
  platform: string;
  data_root: string;
  paper_count: number;
  source_pdf_count: number;
  translated_pdf_count: number;
  note_count: number;
  annotation_count: number;
  ai_thread_count: number;
  missing_file_count: number;
  database_size_bytes: number;
  files_size_bytes: number;
}

export interface ImportPdfResult {
  paper_id: string;
  file_id: string;
  source_pdf: string;
  copied: boolean;
  duplicate: boolean;
  existing_paper_id: string | null;
  duplicate_reason: string | null;
}

export interface ImportTranslationResult {
  paper_id: string;
  file_id: string;
  translated_pdf: string;
  copied: boolean;
}

export interface NativeMetadataDraft {
  title: string;
  authors: string;
  year: number | null;
  venue: string;
  doi: string;
  tags: string[];
  source: 'pdf_text' | 'filename' | 'manual';
  warnings: string[];
}

export interface NativePaperSummary {
  paper_id: string;
  title: string;
  authors: string;
  year: number | null;
  venue: string;
  doi: string;
  source_file_id: string | null;
  source_pdf: string | null;
  translated_file_ids: string[];
  translated_pdfs: string[];
  tags: string[];
  notes: Array<{
    id: string;
    title: string;
    content: string;
    updated_at: number;
  }>;
  annotations: Array<{
    id: string;
    file_id: string;
    resource_id?: string;
    page: number;
    annotation_type: AnnotationType;
    quote: string;
    comment: string;
    color: string;
    position_json: string;
    created_at: number;
    layer_id?: string;
  }>;
  ai_threads: string[];
  folder_id?: string | null;
  created_at?: number;
  last_viewed_at?: number | null;
  is_read?: boolean;
  is_favorite?: boolean;
}

export interface NativeLibraryFolder {
  folder_id: string;
  name: string;
  parent_id: string | null;
  paper_count: number;
}

export interface LibraryFolderRequest {
  name: string;
  parentId?: string | null;
}

export interface NativeAiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

export interface NativeAiThread {
  id: string;
  paper_id: string;
  title: string;
  provider: string;
  model: string;
  created_at: number;
  updated_at: number;
  messages: NativeAiMessage[];
}

export interface UpdatePaperMetadataRequest {
  paperId: string;
  title: string;
  authors: string;
  year: number | '';
  venue: string;
  doi: string;
}

export type PaperFileKind = 'source' | 'translated';

export async function initializeLibrary() {
  return invoke<AsterPaths>('initialize_library');
}

export async function getAsterPaths() {
  return invoke<AsterPaths>('get_aster_paths');
}

export async function getAppDiagnostics() {
  return invoke<AppDiagnostics>('get_app_diagnostics');
}

export async function revealAsterPath(kind: 'root' | 'database' | 'files' | 'backups') {
  return invoke<void>('reveal_aster_path', {
    request: { kind },
  });
}

export async function createLibraryBackup() {
  return invoke<BackupResult>('create_library_backup');
}

export async function restoreLibraryBackup(backupPath: string) {
  return invoke<RestoreBackupResult>('restore_library_backup', { backupPath });
}

export async function selectBackupFolder() {
  const selected = await open({
    multiple: false,
    directory: true,
  });
  return typeof selected === 'string' ? selected : null;
}

export async function extractPdfMetadata(originalPath: string) {
  return invoke<NativeMetadataDraft>('extract_pdf_metadata', { originalPath });
}

export function nativeMetadataToImportDraft(originalPath: string, metadata: NativeMetadataDraft): ImportDraft {
  return {
    title: metadata.title,
    authors: metadata.authors,
    year: metadata.year ?? '',
    venue: metadata.venue,
    doi: metadata.doi,
    tags: metadata.tags.length ? metadata.tags : [FALLBACK_TAG],
    originalPath,
    metadataSource: metadata.source,
    extractionSource: metadata.source,
    extractionWarnings: metadata.warnings,
  };
}

export async function importPdfToLibrary(draft: ImportDraft, paperId?: string) {
  return invoke<ImportPdfResult>('import_pdf_to_library', {
    request: createImportPdfRequest(draft, paperId),
  });
}

export function createImportPdfRequest(draft: ImportDraft, paperId?: string) {
  return {
    original_path: draft.originalPath,
    paper_id: paperId,
    title: draft.title,
    authors: draft.authors,
    year: draft.year || null,
    venue: draft.venue,
    doi: draft.doi,
    tags: draft.tags,
  };
}

export async function importTranslatedPdfToLibrary(request: { paperId: string; originalPath: string; language?: string }) {
  return invoke<ImportTranslationResult>('import_translated_pdf_to_library', {
    request: {
      paper_id: request.paperId,
      original_path: request.originalPath,
      language: request.language ?? 'zh',
    },
  });
}

export async function loadPaperFileBytes(request: { paperId: string; kind: PaperFileKind; fileId?: string }) {
  return invoke<number[]>('load_paper_file_bytes', {
    request: {
      paper_id: request.paperId,
      kind: request.kind,
      file_id: request.fileId || null,
    },
  });
}

export async function revealPaperFile(request: { paperId: string; kind: PaperFileKind; fileId?: string }) {
  return invoke<void>('reveal_paper_file', {
    request: {
      paper_id: request.paperId,
      kind: request.kind,
      file_id: request.fileId || null,
    },
  });
}

export async function openPaperFile(request: { paperId: string; kind: PaperFileKind; fileId?: string }) {
  return invoke<void>('open_paper_file', {
    request: {
      paper_id: request.paperId,
      kind: request.kind,
      file_id: request.fileId || null,
    },
  });
}

export async function listNativePapers() {
  // Startup and every import/capture refresh provision missing summaries before notes are loaded.
  // Keep pure native record mapping usable without loading editor/browser services.
  const { provisionLibrarySummaries } = await import('./library/provisionSummaryNotes');
  await provisionLibrarySummaries();
  return invoke<NativePaperSummary[]>('list_papers');
}

export async function listNativeFolders() {
  const folders = await invoke<NativeLibraryFolder[]>('list_folders');
  return folders.map((folder) => ({
    folderId: folder.folder_id,
    name: folder.name,
    parentId: folder.parent_id,
    paperCount: folder.paper_count,
  } satisfies LibraryFolder));
}

export async function createNativeFolder(request: LibraryFolderRequest) {
  const folder = await invoke<NativeLibraryFolder>('create_folder', {
    request: { name: request.name, parent_id: request.parentId ?? null },
  });
  return {
    folderId: folder.folder_id,
    name: folder.name,
    parentId: folder.parent_id,
    paperCount: folder.paper_count,
  } satisfies LibraryFolder;
}

export async function renameNativeFolder(folderId: string, name: string) {
  return invoke<void>('rename_folder', { request: { folder_id: folderId, name } });
}

export async function deleteNativeFolder(folderId: string) {
  return invoke<void>('delete_folder', { folderId });
}

export async function moveNativePapersToFolder(paperIds: string[], folderId: string | null) {
  return invoke<void>('move_papers_to_folder', { request: { paper_ids: paperIds, folder_id: folderId } });
}

export async function loadNativeDocuments(): Promise<PaperDocument[]> {
  const papers = await listNativePapers();
  return papers.map(nativePaperToDocument);
}

export function nativePaperToDocument(paper: NativePaperSummary): PaperDocument {
  return {
    paperId: paper.paper_id,
    title: paper.title,
    authors: paper.authors || '未知作者',
    year: paper.year ?? '',
    venue: paper.venue || '未知来源',
    doi: paper.doi,
    folderId: paper.folder_id ?? 'library',
    sourceFileId: paper.source_file_id ?? '',
    sourcePdf: paper.source_pdf ?? '',
    translatedFileIds: paper.translated_file_ids ?? [],
    translatedPdfs: paper.translated_pdfs ?? [],
    tags: paper.tags.length ? paper.tags : [FALLBACK_TAG],
    notes: paper.notes.map((note) => ({
      id: note.id,
      paperId: paper.paper_id,
      title: note.title,
      content: note.content,
      format: 'markdown',
      updatedAt: new Date(note.updated_at).toISOString(),
    })),
    annotations: paper.annotations.map((annotation) => mapNativeAnnotation(paper.paper_id, annotation)),
    aiThreads: paper.ai_threads,
    metadataSource: 'sqlite',
    createdAt: paper.created_at == null ? undefined : new Date(paper.created_at).toISOString(),
    lastViewedAt: paper.last_viewed_at == null ? undefined : new Date(paper.last_viewed_at).toISOString(),
    isRead: paper.is_read ?? false,
    isFavorite: paper.is_favorite ?? false,
  };
}

export async function createNativeAnnotation(request: {
  paperId: string;
  fileId: string;
  page: number;
  type: AnnotationType;
  quote: string;
  comment: string;
  color: string;
  positionJson: PositionJson;
  /** Layer captured when the write started; the native side refuses locked/archived layers. */
  layerId: string;
}) {
  return invoke<{ id: string; created_at: number; layer_id: string }>('create_annotation', {
    request: {
      paper_id: request.paperId,
      file_id: request.fileId,
      page: request.page,
      annotation_type: request.type,
      quote: request.quote,
      comment: request.comment,
      color: request.color,
      position_json: JSON.stringify(request.positionJson),
      layer_id: request.layerId,
    },
  });
}

export type NativeAnnotationRow = {
  id: string;
  file_id?: string;
  resource_id?: string;
  page: number;
  annotation_type: AnnotationType;
  quote: string;
  comment: string;
  color: string;
  position_json: string;
  created_at: number;
  layer_id?: string;
};

export function mapNativeAnnotation(paperId: string, annotation: NativeAnnotationRow): Annotation {
  return {
    id: annotation.id,
    paperId,
    fileId: annotation.file_id ?? '',
    resourceId: annotation.resource_id,
    page: annotation.page,
    type: annotation.annotation_type,
    quote: annotation.quote,
    comment: annotation.comment,
    color: annotation.color,
    positionJson: parsePositionJson(annotation.position_json),
    createdAt: new Date(annotation.created_at).toISOString(),
    layerId: annotation.layer_id || defaultAnnotationLayerId(annotation.resource_id ?? paperId),
  };
}

/** Bounded read of one paper's annotations in the given layers (used when a hidden layer is shown). */
export async function listNativePaperAnnotations(paperId: string, layerIds: string[]) {
  const rows = await invoke<NativeAnnotationRow[]>('list_paper_annotations', { paperId, layerIds });
  return rows.map((row) => mapNativeAnnotation(paperId, row));
}

/** Resolves an annotation regardless of layer visibility (note references may target hidden layers). */
export async function getNativeAnnotation(paperId: string, annotationId: string) {
  const row = await invoke<NativeAnnotationRow | null>('get_annotation', { annotationId });
  return row ? mapNativeAnnotation(paperId, row) : null;
}

type NativeAnnotationLayer = {
  id: string; owner_kind: AnnotationLayerOwnerKind; owner_id: string; name: string; sort_order: number; kind: AnnotationLayerKind;
  locked: boolean; archived_at: number | null; created_at: number; updated_at: number; annotation_count: number;
};
type NativeAnnotationLayerState = { owner_kind: AnnotationLayerOwnerKind; owner_id: string; layers: NativeAnnotationLayer[]; view: { active_layer_id: string; visible_layer_ids: string[] } };

function mapNativeLayer(layer: NativeAnnotationLayer): AnnotationLayer {
  return {
    id: layer.id,
    ownerKind: layer.owner_kind,
    ownerId: layer.owner_id,
    name: layer.name,
    sortOrder: layer.sort_order,
    kind: layer.kind,
    locked: layer.locked,
    archivedAt: layer.archived_at == null ? null : new Date(layer.archived_at).toISOString(),
    createdAt: new Date(layer.created_at).toISOString(),
    updatedAt: new Date(layer.updated_at).toISOString(),
    annotationCount: layer.annotation_count,
  };
}

function mapNativeLayerState(state: NativeAnnotationLayerState): AnnotationLayerState {
  return {
    ownerKind: state.owner_kind,
    ownerId: state.owner_id,
    layers: state.layers.map(mapNativeLayer),
    view: { activeLayerId: state.view.active_layer_id, visibleLayerIds: [...state.view.visible_layer_ids] },
  };
}

export async function listNativeAnnotationLayers(ownerKind: AnnotationLayerOwnerKind, ownerId: string) {
  return mapNativeLayerState(await invoke<NativeAnnotationLayerState>('list_annotation_layers', { ownerKind, ownerId }));
}

export async function createNativeAnnotationLayer(request: { ownerKind: AnnotationLayerOwnerKind; ownerId: string; name?: string; kind: 'layer' | 'attempt'; activate: boolean; solo: boolean }) {
  return mapNativeLayerState(await invoke<NativeAnnotationLayerState>('create_annotation_layer', {
    request: { owner_kind: request.ownerKind, owner_id: request.ownerId, name: request.name ?? '', kind: request.kind, activate: request.activate, solo: request.solo },
  }));
}

export async function updateNativeAnnotationLayer(request: { layerId: string; name?: string; locked?: boolean; archived?: boolean }) {
  return mapNativeLayerState(await invoke<NativeAnnotationLayerState>('update_annotation_layer', {
    request: { layer_id: request.layerId, name: request.name ?? null, locked: request.locked ?? null, archived: request.archived ?? null },
  }));
}

export async function reorderNativeAnnotationLayers(request: { ownerKind: AnnotationLayerOwnerKind; ownerId: string; layerIds: string[] }) {
  return mapNativeLayerState(await invoke<NativeAnnotationLayerState>('reorder_annotation_layers', {
    request: { owner_kind: request.ownerKind, owner_id: request.ownerId, layer_ids: request.layerIds },
  }));
}

export async function setNativeAnnotationLayerView(request: { ownerKind: AnnotationLayerOwnerKind; ownerId: string; activeLayerId: string; visibleLayerIds: string[] }) {
  return mapNativeLayerState(await invoke<NativeAnnotationLayerState>('set_annotation_layer_view', {
    request: { owner_kind: request.ownerKind, owner_id: request.ownerId, active_layer_id: request.activeLayerId, visible_layer_ids: request.visibleLayerIds },
  }));
}

export async function moveNativeAnnotationsToLayer(request: { annotationIds: string[]; targetLayerId: string }) {
  return invoke<{ moved: number; target_layer_id: string }>('move_annotations_to_layer', {
    request: { annotation_ids: request.annotationIds, target_layer_id: request.targetLayerId },
  });
}

export async function previewNativeAnnotationLayerDelete(layerId: string): Promise<AnnotationLayerDeletePreview> {
  const preview = await invoke<{ layer_id: string; name: string; annotation_count: number; referencing_note_count: number; move_targets: NativeAnnotationLayer[]; deletable: boolean; reason: string | null }>('preview_annotation_layer_delete', { layerId });
  return {
    layerId: preview.layer_id,
    name: preview.name,
    annotationCount: preview.annotation_count,
    referencingNoteCount: preview.referencing_note_count,
    moveTargets: preview.move_targets.map(mapNativeLayer),
    deletable: preview.deletable,
    reason: preview.reason,
  };
}

export async function deleteNativeAnnotationLayer(request: { layerId: string; mode: 'move' | 'purge'; targetLayerId?: string }) {
  return mapNativeLayerState(await invoke<NativeAnnotationLayerState>('delete_annotation_layer', {
    request: { layer_id: request.layerId, mode: request.mode, target_layer_id: request.targetLayerId ?? null },
  }));
}

export async function listNativeResourceAnnotations(resourceId: string, layerIds?: string[]) {
  return invoke<Array<{
    id: string;
    resource_id: string;
    page: number;
    annotation_type: AnnotationType;
    quote: string;
    comment: string;
    color: string;
    position_json: string;
    created_at: number;
    layer_id?: string;
  }>>('list_resource_annotations', { resourceId, layerIds: layerIds ?? null });
}

export async function createNativeResourceAnnotation(request: {
  resourceId: string;
  page: number;
  type: AnnotationType;
  quote: string;
  comment: string;
  color: string;
  positionJson: PositionJson;
  layerId?: string;
}) {
  return invoke<string>('create_resource_annotation', { request: {
    resource_id: request.resourceId,
    page: request.page,
    annotation_type: request.type,
    quote: request.quote,
    comment: request.comment,
    color: request.color,
    position_json: JSON.stringify(request.positionJson),
    layer_id: request.layerId ?? '',
  } });
}

export async function updateNativeResourceAnnotationComment(request: { annotationId: string; comment: string }) {
  return invoke<void>('update_resource_annotation_comment', { request: { annotation_id: request.annotationId, comment: request.comment } });
}

export async function updateNativeResourceAnnotationColor(request: { annotationId: string; color: string }) {
  return invoke<void>('update_resource_annotation_color', { request: { annotation_id: request.annotationId, color: request.color } });
}

export async function updateNativeResourceAnnotationPosition(request: { annotationId: string; positionJson: PositionJson }) {
  return invoke<void>('update_resource_annotation_position', { request: { annotation_id: request.annotationId, position_json: JSON.stringify(request.positionJson) } });
}

export async function deleteNativeResourceAnnotation(annotationId: string) {
  return invoke<void>('delete_resource_annotation', { request: { annotation_id: annotationId } });
}

export async function restoreNativeAnnotation(annotation: PaperDocument['annotations'][number]) {
  return invoke<{ id: string }>('restore_annotation', {
    request: {
      annotation_id: annotation.id,
      paper_id: annotation.paperId,
      file_id: annotation.fileId,
      page: annotation.page,
      annotation_type: annotation.type,
      quote: annotation.quote,
      comment: annotation.comment,
      color: annotation.color,
      position_json: JSON.stringify(annotation.positionJson),
      created_at: annotation.createdAt ? Date.parse(annotation.createdAt) : Date.now(),
      layer_id: annotation.layerId ?? '',
    },
  });
}

export async function updateNativeAnnotationComment(request: { annotationId: string; comment: string }) {
  return invoke<{ id: string }>('update_annotation_comment', {
    request: {
      annotation_id: request.annotationId,
      comment: request.comment,
    },
  });
}

export async function updateNativeAnnotationColor(request: { annotationId: string; color: string }) {
  return invoke<{ id: string }>('update_annotation_color', {
    request: {
      annotation_id: request.annotationId,
      color: request.color,
    },
  });
}

export async function updateNativeAnnotationPosition(request: { annotationId: string; positionJson: PositionJson }) {
  return invoke<{ id: string }>('update_annotation_position', {
    request: {
      annotation_id: request.annotationId,
      position_json: JSON.stringify(request.positionJson),
    },
  });
}

export async function deleteNativeAnnotation(annotationId: string) {
  return invoke<{ id: string }>('delete_annotation', {
    request: {
      annotation_id: annotationId,
    },
  });
}

export async function upsertNativeNote(request: { paperId: string; noteId?: string; title: string; content: string; expected?: { title: string; content: string } }) {
  return invoke<{ id: string }>('upsert_note', {
    request: {
      paper_id: request.paperId,
      note_id: request.noteId ?? null,
      expected: request.expected ?? null,
      title: request.title,
      content: request.content,
    },
  });
}

export async function deleteNativeNote(noteId: string) {
  return invoke<{ id: string }>('delete_note', { noteId });
}

export async function updateNativePaperMetadata(request: UpdatePaperMetadataRequest) {
  return invoke<{ paper_id: string }>('update_paper_metadata', {
    request: {
      paper_id: request.paperId,
      title: request.title,
      authors: request.authors,
      year: request.year || null,
      venue: request.venue,
      doi: request.doi,
    },
  });
}

export async function updateNativePaperTags(request: { paperId: string; tags: string[] }) {
  return invoke<{ paper_id: string }>('update_paper_tags', {
    request: {
      paper_id: request.paperId,
      tags: request.tags,
    },
  });
}

export async function deleteNativePaper(paperId: string) {
  return invoke<{ paper_id: string }>('delete_paper', { paperId });
}

export async function listNativeAiThreads(paperId: string) {
  return invoke<NativeAiThread[]>('list_ai_threads', { paperId });
}

export async function appendNativeAiMessage(request: { paperId: string; threadId?: string; role: 'user' | 'assistant'; content: string }) {
  return invoke<{ thread_id: string; message_id: string }>('append_ai_message', {
    request: {
      paper_id: request.paperId,
      thread_id: request.threadId ?? null,
      role: request.role,
      content: request.content,
    },
  });
}

export async function clearNativeAiThreads(paperId: string) {
  return invoke<{ paper_id: string }>('clear_ai_threads', { paperId });
}

export async function selectPdfFile() {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  return typeof selected === 'string' ? selected : null;
}

export async function selectPluginPackage() {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Aster Plugin', extensions: ['aster-plugin', 'aster-plugin.json', 'json'] }],
  });
  return typeof selected === 'string' ? selected : null;
}

export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function parsePositionJson(raw: string): PositionJson {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? (parsed as PositionJson) : {};
  } catch {
    return {};
  }
}

export async function restartAfterLibraryRestore() { return invoke<void>('restart_after_library_restore'); }

/* --- library file storage root (task 6557dc15) --------------------------- */

export interface LibraryStorageInfo {
  root: string;
  filesRoot: string;
  papersRoot: string;
  defaultFilesRoot: string;
  isCustom: boolean;
  freeBytes: number | null;
  totalBytes: number | null;
  filesSizeBytes: number;
  onSystemDrive: boolean | null;
  recommendedRoot: string | null;
  promptDismissed: boolean;
  isolated: boolean;
  migrationActive: boolean;
  captureCacheRoot: string;
}

export interface LibraryStorageCandidate {
  path: string;
  onSystemDrive: boolean | null;
  freeBytes: number | null;
  totalBytes: number | null;
}

export interface LibraryStorageMigrationProgress {
  phase: 'copying' | 'database' | 'cleanup' | 'done' | string;
  copiedFiles: number;
  totalFiles: number;
  copiedBytes: number;
  totalBytes: number;
  current: string | null;
}

export interface LibraryStorageMigrationReport {
  from: string;
  to: string;
  filesMoved: number;
  bytesMoved: number;
  databaseRowsUpdated: number;
  warnings: string[];
  filesRoot: string;
  isCustom: boolean;
}

export const LIBRARY_STORAGE_MIGRATION_EVENT = 'library://storage-migration';

export async function getLibraryStorage() {
  return invoke<LibraryStorageInfo>('get_library_storage');
}

export async function validateLibraryFilesRoot(path: string) {
  return invoke<LibraryStorageCandidate>('validate_library_files_root', { path });
}

/** `null` restores the default `<AsterData>/files`; `migrate` moves the existing tree first. */
export async function setLibraryFilesRoot(path: string | null, migrate: boolean) {
  return invoke<LibraryStorageMigrationReport>('set_library_files_root', { path, migrate });
}

export async function cancelLibraryFilesRootMigration() {
  return invoke<void>('cancel_library_files_root_migration');
}

export async function dismissLibraryStoragePrompt() {
  return invoke<void>('dismiss_library_storage_prompt');
}

export async function selectLibraryFilesRoot(defaultPath?: string) {
  const selected = await open({
    multiple: false,
    directory: true,
    defaultPath,
    title: '选择 PDF 与译文文件的存储位置',
  });
  return typeof selected === 'string' ? selected : null;
}

export function formatByteSize(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
