import type { RefObject } from 'react';
import type { AiThreadContext, ImportDraft, PaperDocument, WorkbenchPanelId } from '../../core/types';
import type { WorkspacePanelDefinition } from '../../workbench';

export type LibrarySortKey = 'title' | 'authors' | 'year' | 'venue';
export type LibrarySortDirection = 'asc' | 'desc';
export type LibrarySort = { key: LibrarySortKey; direction: LibrarySortDirection };
export type ImportState = 'idle' | 'selecting' | 'extracting' | 'ready' | 'importing' | 'error';
export type ImportMetadataSourcePreference = 'crossrefFirst' | 'arxivFirst' | 'localOnly';
export type ImportDialogSettings = {
  metadataSourcePreference: ImportMetadataSourcePreference;
  onlineMetadataEnabled: boolean;
};

export type LibrarySceneProps = {
  papers: PaperDocument[];
  selectedPaper: PaperDocument | null;
  tags: string[];
  activeTag: string;
  query: string;
  sort: LibrarySort;
  status: string;
  lastImportedPaperTitle: string;
  detailOpen: boolean;
  aiThreadContexts: AiThreadContext[];
  bulkSelectedPaperIds: string[];
  searchInputRef: RefObject<HTMLInputElement | null>;
  sidePanels: WorkspacePanelDefinition<WorkbenchPanelId>[];
  onQueryChange: (query: string) => void;
  onSelectPaper: (paperId: string) => void;
  onBulkSelectionChange: (paperIds: string[]) => void;
  onOpenPaper: (paperId: string) => void;
  onSelectTag: (tag: string) => void;
  onSortChange: (sort: LibrarySort) => void;
  onDetailOpenChange: (open: boolean) => void;
  onOpenImport: () => void;
  onOpenReader: () => void;
  onOpenRelations: () => void;
  onOpenTranslationImport: () => void;
  onRevealSourcePdf: () => void;
  onRevealTranslatedPdf: () => void;
  onOpenSourcePdfExternal: () => void;
  onOpenTranslatedPdfExternal: () => void;
  onOpenMetadataEdit: () => void;
  onOpenTagsEdit: () => void;
  onOpenBulkTagsEdit: () => void;
  onBulkDelete: () => void;
  onDeletePaper: () => void;
  onCopyMarkdown: () => void;
  onCopyCsv: () => void;
  onCopyBibtex: () => void;
  onCopyBulkBibtex: () => void;
};

export type LibraryDetailPanelProps = {
  paper: PaperDocument;
  aiThreadContexts: AiThreadContext[];
  onOpenReader: () => void;
  onOpenRelations: () => void;
  onOpenTranslationImport: () => void;
  onRevealSourcePdf: () => void;
  onRevealTranslatedPdf: () => void;
  onOpenSourcePdfExternal: () => void;
  onOpenTranslatedPdfExternal: () => void;
  onOpenMetadataEdit: () => void;
  onOpenTagsEdit: () => void;
  onCopyBibtex: () => void;
};

export type ImportDialogProps = {
  draft: ImportDraft;
  suggestions: string[];
  state: ImportState;
  settings: ImportDialogSettings;
  onChangeDraft: (draft: ImportDraft) => void;
  onSelectPdf: () => void | Promise<void>;
  onRegenerate: () => void | Promise<void>;
  onClose: () => void;
  onConfirm: () => void;
};
