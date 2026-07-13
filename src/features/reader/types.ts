import type { ReactNode } from 'react';
import type {
  AnnotationColor,
  AnnotationDraft,
  AiThreadContext,
  PaperDocument,
  PositionJson,
  ReaderLayout,
  ReaderSidePanelTab,
  ReaderTool,
  WorkbenchPanelContribution,
} from '../../core/types';
import type { PaperFileKind } from '../../platform/nativeApi';
import type { WorkspacePanelDefinition } from '../../workbench';
import { defaultReaderToolSettings } from './pdf/types';

export type { ArrowEnding, ArrowStyle, EraserShape, PdfScrollAnchor, ReaderToolSettings, ShapeKind } from './pdf/types';
export { defaultReaderToolSettings };

export type ReaderContentMode = 'pdf' | 'markdown';
export type ReaderFileMode = PaperFileKind | 'parallel';

export type NoteDraftPatch = { append?: string };

export type NoteSaveInput = {
  noteId?: string;
  title: string;
  content: string;
};

export type ReaderSaveState = 'saved' | 'dirty' | 'saving' | 'error';

export type ReaderSidePanelDefinition = WorkspacePanelDefinition<ReaderSidePanelTab> & {
  icon: () => ReactNode;
  panel: WorkbenchPanelContribution;
  commandId: string;
  commandTitle: string;
};

export type ReaderSceneProps = {
  paper: PaperDocument;
  layout: ReaderLayout;
  contentMode: ReaderContentMode;
  fileMode: ReaderFileMode;
  translatedFileId: string;
  activeParallelFileKind: PaperFileKind;
  parallelSyncLocked: boolean;
  activeAnnotationTool: ReaderTool;
  zoom: number;
  requestedPage: number | null;
  sidePanelOpen: boolean;
  sidePanelTab: ReaderSidePanelTab;
  aiThreadContexts: AiThreadContext[];
  sidePanels: ReaderSidePanelDefinition[];
  onLayoutChange: (layout: ReaderLayout) => void;
  onContentModeChange: (mode: ReaderContentMode) => void;
  onFileModeChange: (mode: ReaderFileMode) => void;
  onTranslatedFileIdChange: (fileId: string) => void;
  onActiveParallelFileKindChange: (kind: PaperFileKind) => void;
  onParallelSyncLockedChange: (locked: boolean) => void;
  onSelectAnnotationTool: (type: ReaderTool) => void;
  onSelectAnnotationColor: (color: AnnotationColor) => void;
  customAnnotationColor: string;
  onCustomAnnotationColorChange: (color: string) => void;
  onZoomChange: (zoom: number, anchor?: { x: number; y: number }) => void;
  onFitWidth: () => void;
  onSidePanelOpenChange: (open: boolean) => void;
  onSidePanelTabChange: (tab: ReaderSidePanelTab) => void;
  onCreateAnnotation: (annotation: AnnotationDraft & { page: number }, fileKind?: PaperFileKind) => void | Promise<string | undefined>;
  onUpdateAnnotationComment: (annotationId: string, comment: string) => void | Promise<void>;
  onUpdateAnnotationPosition: (annotationId: string, positionJson: PositionJson) => void | Promise<void>;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  readerPageState: { currentPage: number; totalPages: number };
  focusedAnnotationId: string | null;
  activeAnnotationColor: AnnotationColor;
  onReaderStateChange: (state: { currentPage: number; totalPages: number }) => void;
  onFocusAnnotation: (annotationId: string | null) => void;
  onJumpToPage: (page: number) => void;
  onNoteSave: (note: NoteSaveInput) => void | Promise<string | void>;
  onCreateNote: () => void | Promise<string | void>;
  noteDraftPatch: NoteDraftPatch | null;
  onNoteDraftPatchConsumed: () => void;
  onAppendAnnotationToNote: (annotationId: string) => void;
};
