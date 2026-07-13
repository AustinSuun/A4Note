import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type {
  AnnotationColor,
  AnnotationDraft,
  PaperDocument,
  ReaderLayout,
  ReaderSidePanelTab,
  ReaderTool,
  PositionJson,
  AiThreadContext,
} from '../../core/types';
import type { PaperFileKind } from '../../platform/nativeApi';
import type { NoteDraftPatch, NoteSaveInput, ReaderContentMode, ReaderFileMode, ReaderSidePanelDefinition } from './types';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type ReaderContextValue = {
  // 当前文献
  paper: PaperDocument;

  // 布局与模式
  layout: ReaderLayout;
  contentMode: ReaderContentMode;
  fileMode: ReaderFileMode;

  // PDF 状态
  zoom: number;
  pageState: { currentPage: number; totalPages: number };
  requestedPage: number | null;
  focusedAnnotationId: string | null;

  // 侧边面板
  sidePanelOpen: boolean;
  sidePanelTab: ReaderSidePanelTab;
  sidePanels: ReaderSidePanelDefinition[];

  // 文件选择
  translatedFileId: string;
  activeParallelFileKind: PaperFileKind;
  parallelSyncLocked: boolean;

  // 标注工具
  activeAnnotationTool: ReaderTool;
  activeAnnotationColor: AnnotationColor;
  customAnnotationColor: string;

  // AI 线程上下文
  aiThreadContexts: unknown[];

  // 笔记协议
  noteDraftPatch: NoteDraftPatch;

  // ── Actions ──

  setLayout: (layout: ReaderLayout) => void;
  setContentMode: (mode: ReaderContentMode) => void;
  setFileMode: (mode: ReaderFileMode) => void;

  setZoom: (zoom: number, anchor?: { x: number; y: number }) => void;
  fitToWidth: () => void;
  jumpToPage: (page: number) => void;
  setPageState: (state: { currentPage: number; totalPages: number }) => void;
  setFocusedAnnotationId: (id: string | null) => void;

  setSidePanelOpen: (open: boolean) => void;
  setSidePanelTab: (tab: ReaderSidePanelTab) => void;

  setTranslatedFileId: (fileId: string) => void;
  setActiveParallelFileKind: (kind: PaperFileKind) => void;
  setParallelSyncLocked: (locked: boolean) => void;

  selectAnnotationTool: (tool: ReaderTool) => void;
  selectAnnotationColor: (color: AnnotationColor) => void;
  setCustomAnnotationColor: (color: string) => void;

  setNoteDraftPatch: (patch: NoteDraftPatch) => void;
  consumeNoteDraftPatch: () => void;

  // 标注 CRUD
  createAnnotation: (annotation: AnnotationDraft & { page: number }, fileKind?: PaperFileKind) => void | Promise<string | undefined>;
  updateAnnotationComment: (annotationId: string, comment: string) => void | Promise<void>;
  updateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  updateAnnotationPosition: (annotationId: string, positionJson: PositionJson) => void | Promise<void>;
  deleteAnnotation: (annotationId: string) => void | Promise<void>;
  undoAnnotation: () => void;
  redoAnnotation: () => void;
  canUndo: boolean;
  canRedo: boolean;

  appendAnnotationToNote: (annotationId: string) => void;
  saveNote: (note: NoteSaveInput) => void | Promise<string | void>;
  createNote: () => void | Promise<string | void>;
};

// ─────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────

const ReaderContext = createContext<ReaderContextValue | null>(null);

// ─────────────────────────────────────────────────────────────
// Provider props — mirrors current ReaderSceneProps exactly
// so App.tsx can pass the same props through ReaderProvider
// ─────────────────────────────────────────────────────────────

export type ReaderProviderProps = {
  children: ReactNode;

  paper: PaperDocument;
  layout: ReaderLayout;
  contentMode: ReaderContentMode;
  fileMode: ReaderFileMode;
  translatedFileId: string;
  activeParallelFileKind: PaperFileKind;
  parallelSyncLocked: boolean;
  activeAnnotationTool: ReaderTool;
  activeAnnotationColor: AnnotationColor;
  customAnnotationColor: string;
  zoom: number;
  readerPageState: { currentPage: number; totalPages: number };
  requestedPage: number | null;
  focusedAnnotationId: string | null;
  sidePanelOpen: boolean;
  sidePanelTab: ReaderSidePanelTab;
  sidePanels: ReaderSidePanelDefinition[];
  aiThreadContexts: AiThreadContext[];
  noteDraftPatch: NoteDraftPatch | null;

  onLayoutChange: (layout: ReaderLayout) => void;
  onContentModeChange: (mode: ReaderContentMode) => void;
  onFileModeChange: (mode: ReaderFileMode) => void;
  onTranslatedFileIdChange: (fileId: string) => void;
  onActiveParallelFileKindChange: (kind: PaperFileKind) => void;
  onParallelSyncLockedChange: (locked: boolean) => void;
  onSelectAnnotationTool: (type: ReaderTool) => void;
  onSelectAnnotationColor: (color: AnnotationColor) => void;
  onCustomAnnotationColorChange: (color: string) => void;
  onZoomChange: (zoom: number, anchor?: { x: number; y: number }) => void;
  onFitWidth: () => void;
  onSidePanelOpenChange: (open: boolean) => void;
  onSidePanelTabChange: (tab: ReaderSidePanelTab) => void;
  onJumpToPage: (page: number) => void;
  onReaderStateChange: (state: { currentPage: number; totalPages: number }) => void;
  onFocusAnnotation: (id: string | null) => void;
  onNoteDraftPatchConsumed: () => void;
  onAppendAnnotationToNote: (annotationId: string) => void;
  onNoteSave: (note: NoteSaveInput) => void | Promise<string | void>;
  onCreateNote: () => void | Promise<string | void>;

  // annotation handlers from useAnnotationHistory
  onCreateAnnotation: (annotation: AnnotationDraft & { page: number }, fileKind?: PaperFileKind) => void | Promise<string | undefined>;
  onUpdateAnnotationComment: (annotationId: string, comment: string) => void | Promise<void>;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onUpdateAnnotationPosition: (annotationId: string, positionJson: PositionJson) => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  onUndoAnnotation?: () => void;
  onRedoAnnotation?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
};

// ─────────────────────────────────────────────────────────────
// Provider implementation
// ─────────────────────────────────────────────────────────────

export function ReaderProvider({
  children,
  paper,
  layout,
  contentMode,
  fileMode,
  translatedFileId,
  activeParallelFileKind,
  parallelSyncLocked,
  activeAnnotationTool,
  activeAnnotationColor,
  customAnnotationColor,
  zoom,
  readerPageState,
  requestedPage,
  focusedAnnotationId,
  sidePanelOpen,
  sidePanelTab,
  sidePanels,
  aiThreadContexts,
  noteDraftPatch,
  onLayoutChange,
  onContentModeChange,
  onFileModeChange,
  onTranslatedFileIdChange,
  onActiveParallelFileKindChange,
  onParallelSyncLockedChange,
  onSelectAnnotationTool,
  onSelectAnnotationColor,
  onCustomAnnotationColorChange,
  onZoomChange,
  onFitWidth,
  onSidePanelOpenChange,
  onSidePanelTabChange,
  onJumpToPage,
  onReaderStateChange,
  onFocusAnnotation,
  onNoteDraftPatchConsumed,
  onAppendAnnotationToNote,
  onNoteSave,
  onCreateNote,
  onCreateAnnotation,
  onUpdateAnnotationComment,
  onUpdateAnnotationColor,
  onUpdateAnnotationPosition,
  onDeleteAnnotation,
  onUndoAnnotation,
  onRedoAnnotation,
  canUndo,
  canRedo,
}: ReaderProviderProps) {
  const value: ReaderContextValue = useMemo(
    () => ({
      paper,
      layout,
      contentMode,
      fileMode,
      zoom,
      pageState: readerPageState,
      requestedPage,
      focusedAnnotationId,
      sidePanelOpen,
      sidePanelTab,
      sidePanels,
      translatedFileId,
      activeParallelFileKind,
      parallelSyncLocked,
      activeAnnotationTool,
      activeAnnotationColor,
      customAnnotationColor,
      aiThreadContexts,
      noteDraftPatch: noteDraftPatch ?? {},

      setLayout: onLayoutChange,
      setContentMode: onContentModeChange,
      setFileMode: onFileModeChange,
      setZoom: onZoomChange,
      fitToWidth: onFitWidth,
      jumpToPage: onJumpToPage,
      setPageState: onReaderStateChange,
      setFocusedAnnotationId: onFocusAnnotation,
      setSidePanelOpen: onSidePanelOpenChange,
      setSidePanelTab: onSidePanelTabChange,
      setTranslatedFileId: onTranslatedFileIdChange,
      setActiveParallelFileKind: onActiveParallelFileKindChange,
      setParallelSyncLocked: onParallelSyncLockedChange,
      selectAnnotationTool: onSelectAnnotationTool,
      selectAnnotationColor: onSelectAnnotationColor,
      setCustomAnnotationColor: onCustomAnnotationColorChange,
      setNoteDraftPatch: () => {},
      consumeNoteDraftPatch: onNoteDraftPatchConsumed,

      createAnnotation: onCreateAnnotation,
      updateAnnotationComment: onUpdateAnnotationComment,
      updateAnnotationColor: onUpdateAnnotationColor,
      updateAnnotationPosition: onUpdateAnnotationPosition,
      deleteAnnotation: onDeleteAnnotation,
      undoAnnotation: onUndoAnnotation ?? (() => {}),
      redoAnnotation: onRedoAnnotation ?? (() => {}),
      canUndo: canUndo ?? false,
      canRedo: canRedo ?? false,

      appendAnnotationToNote: onAppendAnnotationToNote,
      saveNote: onNoteSave,
      createNote: onCreateNote,
    }),
    [
      paper,
      layout,
      contentMode,
      fileMode,
      zoom,
      readerPageState,
      requestedPage,
      focusedAnnotationId,
      sidePanelOpen,
      sidePanelTab,
      sidePanels,
      translatedFileId,
      activeParallelFileKind,
      parallelSyncLocked,
      activeAnnotationTool,
      activeAnnotationColor,
      customAnnotationColor,
      aiThreadContexts,
      noteDraftPatch,
      onLayoutChange,
      onContentModeChange,
      onFileModeChange,
      onZoomChange,
      onFitWidth,
      onJumpToPage,
      onReaderStateChange,
      onFocusAnnotation,
      onSidePanelOpenChange,
      onSidePanelTabChange,
      onTranslatedFileIdChange,
      onActiveParallelFileKindChange,
      onParallelSyncLockedChange,
      onSelectAnnotationTool,
      onSelectAnnotationColor,
      onCustomAnnotationColorChange,
      onNoteDraftPatchConsumed,
      onAppendAnnotationToNote,
      onNoteSave,
      onCreateNote,
      onCreateAnnotation,
      onUpdateAnnotationComment,
      onUpdateAnnotationColor,
      onUpdateAnnotationPosition,
      onDeleteAnnotation,
      onUndoAnnotation,
      onRedoAnnotation,
      canUndo,
      canRedo,
    ]
  );

  return <ReaderContext.Provider value={value}>{children}</ReaderContext.Provider>;
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function useReaderContext(): ReaderContextValue {
  const ctx = useContext(ReaderContext);
  if (!ctx) {
    throw new Error('useReaderContext must be used inside <ReaderProvider>');
  }
  return ctx;
}
