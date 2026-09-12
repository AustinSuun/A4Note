import type { RefObject } from 'react';
import type { AiThreadContext, ImportDraft, LibraryFolder, PaperDocument, WorkbenchPanelId } from '../../core/types';
import type { WorkspacePanelDefinition } from '../../workbench';
import type { WorkbenchPanelViewContribution } from '../../workbench';

export type LibrarySortKey = 'title' | 'authors' | 'year' | 'venue' | 'createdAt' | 'lastViewedAt';
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
  folders: LibraryFolder[];
  selectedPaper: PaperDocument | null;
  tags: string[];
  activeTag: string;
  activeFolderId: string;
  query: string;
  sort: LibrarySort;
  detailOpen: boolean;
  aiThreadContexts: AiThreadContext[];
  bulkSelectedPaperIds: string[];
  searchInputRef: RefObject<HTMLInputElement | null>;
  sidePanels: WorkspacePanelDefinition<WorkbenchPanelId>[];
  panelViews?: WorkbenchPanelViewContribution[];
  onQueryChange: (query: string) => void;
  onSelectPaper: (paperId: string) => void;
  onBulkSelectionChange: (paperIds: string[]) => void;
  onMovePapersToFolder: (paperIds: string[], folderId: string | null) => void | Promise<void>;
  onOpenPaper: (paperId: string) => void;
  onSelectTag: (tag: string) => void;
  onSelectFolder: (folderId: string) => void;
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
  stateBusy?: boolean;
  onToggleRead?: () => void;
  onToggleFavorite?: () => void;
};

export type LibraryFolderActionProps = {
  folders: LibraryFolder[];
  papers: PaperDocument[];
  activeFolderId: string;
  activeTag: string;
  tags: string[];
  selectedPaperId?: string;
  onSelectFolder: (folderId: string) => void;
  onSelectTag: (tag: string) => void;
  onSelectPaper: (paperId: string) => void;
  onOpenPaper?: (paperId: string) => void;
  onMovePapersToFolder: (paperIds: string[], folderId: string | null) => void | Promise<void>;
  onCreateFolder: (name: string, parentId: string | null) => void | Promise<void>;
  onRenameFolder: (folderId: string, name: string) => void | Promise<void>;
  onDeleteFolder: (folderId: string) => void | Promise<void>;
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
