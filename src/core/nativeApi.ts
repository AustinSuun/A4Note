import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { AnnotationType, ImportDraft, PaperDocument, PositionJson } from './types';

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
    page: number;
    annotation_type: AnnotationType;
    quote: string;
    comment: string;
    color: string;
    position_json: string;
    created_at: number;
  }>;
  ai_threads: string[];
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
  return invoke<NativePaperSummary[]>('list_papers');
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
    folderId: 'library',
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
    annotations: paper.annotations.map((annotation) => ({
      id: annotation.id,
      paperId: paper.paper_id,
      fileId: annotation.file_id,
      page: annotation.page,
      type: annotation.annotation_type,
      quote: annotation.quote,
      comment: annotation.comment,
      color: annotation.color,
      positionJson: parsePositionJson(annotation.position_json),
      createdAt: new Date(annotation.created_at).toISOString(),
    })),
    aiThreads: paper.ai_threads,
    metadataSource: 'sqlite',
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
}) {
  return invoke<{ id: string }>('create_annotation', {
    request: {
      paper_id: request.paperId,
      file_id: request.fileId,
      page: request.page,
      annotation_type: request.type,
      quote: request.quote,
      comment: request.comment,
      color: request.color,
      position_json: JSON.stringify(request.positionJson),
    },
  });
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

export async function upsertNativeNote(request: { paperId: string; noteId?: string; title: string; content: string }) {
  return invoke<{ id: string }>('upsert_note', {
    request: {
      paper_id: request.paperId,
      note_id: request.noteId ?? null,
      title: request.title,
      content: request.content,
    },
  });
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
