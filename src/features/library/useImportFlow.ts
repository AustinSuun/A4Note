import { useState, type Dispatch, type SetStateAction } from 'react';
import { createImportDraft, type createAsterCore } from '../../core/asterCore';
import type { ImportDraft, PaperDocument } from '../../core/types';
import { preferredReaderFile, preferredReaderMode, preferredTranslatedFileId } from '../reader';
import type { ImportState } from './types';
import {
  extractPdfMetadata,
  importPdfToLibrary,
  importTranslatedPdfToLibrary,
  isTauriRuntime,
  nativeMetadataToImportDraft,
  selectPdfFile,
  type PaperFileKind,
} from '../../platform/nativeApi';
import { normalizeEditableTags } from '../../ui/tagInput';
import { zh } from '../../ui/zh';

type AsterCore = ReturnType<typeof createAsterCore>;

export function useImportFlow({
  aster,
  selectedPaper,
  refreshNativeDocuments,
  openReaderForPaper,
  setSelectedPaperId,
  setReaderContentMode,
  setReaderFileMode,
  setReaderTranslatedFileId,
  setActiveTag,
  setRevision,
  setLibraryStatus,
}: {
  aster: AsterCore;
  selectedPaper: PaperDocument | null;
  refreshNativeDocuments: (preferredPaperId?: string) => Promise<void>;
  openReaderForPaper: (paperId: string) => void;
  setSelectedPaperId: (paperId: string) => void;
  setReaderContentMode: (mode: ReturnType<typeof preferredReaderMode>) => void;
  setReaderFileMode: (mode: PaperFileKind) => void;
  setReaderTranslatedFileId: Dispatch<SetStateAction<string>>;
  setActiveTag: (tag: string) => void;
  setRevision: Dispatch<SetStateAction<number>>;
  setLibraryStatus: (status: string) => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [importState, setImportState] = useState<ImportState>('idle');
  const [draft, setDraft] = useState<ImportDraft>(() => createImportDraft(''));
  const [lastImportedPaperTitle, setLastImportedPaperTitle] = useState('');

  const openImportDialog = () => {
    setDraft(createImportDraft(''));
    setImportState('idle');
    setImportOpen(true);
  };

  const extractDraftForPath = async (path: string) => {
    if (!path) return;
    if (!isTauriRuntime()) {
      setDraft(createImportDraft(path));
      setImportState('ready');
      return;
    }
    setImportState('extracting');
    try {
      const metadata = await extractPdfMetadata(path);
      setDraft(nativeMetadataToImportDraft(path, metadata));
      setImportState('ready');
    } catch (error) {
      console.error('Metadata extraction failed', error);
      setDraft({ ...createImportDraft(path), extractionWarnings: [zh.importDialog.error] });
      setImportState('error');
    }
  };

  const choosePdfIntoDraft = async () => {
    setImportState('selecting');
    if (!isTauriRuntime()) {
      await extractDraftForPath('retrieval-augmented-generation-2020.pdf');
      return;
    }
    try {
      const selected = await selectPdfFile();
      if (!selected) {
        setImportState(draft.originalPath ? 'ready' : 'idle');
        return;
      }
      await extractDraftForPath(selected);
    } catch (error) {
      console.error('Failed to open PDF dialog', error);
      setDraft((current) => ({
        ...current,
        extractionWarnings: [zh.importDialog.openFailed],
      }));
      setImportState('error');
    }
  };

  const confirmImport = async () => {
    if (!draft.originalPath.trim()) {
      setLibraryStatus(zh.app.chooseFirst);
      setImportState('error');
      return;
    }
    const normalizedDraft = normalizeImportDraftForConfirm(draft);
    setDraft(normalizedDraft);
    setImportState('importing');
    if (isTauriRuntime()) {
      try {
        const imported = await importPdfToLibrary(normalizedDraft);
        const targetPaperId = imported.existing_paper_id || imported.paper_id;
        await refreshNativeDocuments(targetPaperId);
        setActiveTag('all');
        setImportOpen(false);
        setLastImportedPaperTitle(imported.duplicate ? '' : normalizedDraft.title || imported.paper_id);
        setLibraryStatus(imported.duplicate ? zh.app.importDuplicate : zh.app.importSuccess);
        openReaderForPaper(targetPaperId);
        return;
      } catch (error) {
        console.error('PDF import failed', error);
        setLibraryStatus(zh.app.importFailed);
        setDraft((current) => ({
          ...current,
          extractionWarnings: [...(current.extractionWarnings ?? []), zh.importDialog.importFailedInline],
        }));
        setImportState('error');
        return;
      }
    }
    const imported = aster.commands.execute<ImportDraft, PaperDocument>('document.importFromDraft', normalizedDraft);
    setLastImportedPaperTitle(imported.title);
    setSelectedPaperId(imported.paperId);
    setReaderContentMode(preferredReaderMode(imported));
    setReaderFileMode(preferredReaderFile(imported));
    setReaderTranslatedFileId(preferredTranslatedFileId(imported));
    setActiveTag('all');
    setImportOpen(false);
    setRevision((current) => current + 1);
  };

  const importTranslatedPdf = async () => {
    if (!selectedPaper) return;
    try {
      const selected = await selectPdfFile();
      if (!selected) return;
      const imported = await importTranslatedPdfToLibrary({ paperId: selectedPaper.paperId, originalPath: selected, language: 'zh' });
      await refreshNativeDocuments(selectedPaper.paperId);
      setReaderContentMode('pdf');
      setReaderFileMode('translated');
      setReaderTranslatedFileId(imported.file_id);
      setLibraryStatus(zh.library.translationImported);
    } catch (error) {
      console.error('Translated PDF import failed', error);
      setLibraryStatus(zh.library.translationImportFailed);
    }
  };

  return {
    importOpen,
    importState,
    draft,
    lastImportedPaperTitle,
    setDraft,
    setImportOpen,
    openImportDialog,
    extractDraftForPath,
    choosePdfIntoDraft,
    confirmImport,
    importTranslatedPdf,
  };
}

function normalizeImportDraftForConfirm(draft: ImportDraft): ImportDraft {
  const title = draft.title.trim() || titleFromPath(draft.originalPath) || zh.importDialog.untitledDocument;
  const year = typeof draft.year === 'number' && draft.year >= 1000 && draft.year <= 9999 ? draft.year : '';
  return {
    ...draft,
    title,
    authors: draft.authors.trim(),
    year,
    venue: draft.venue.trim(),
    doi: draft.doi.trim(),
    tags: normalizeEditableTags(draft.tags),
  };
}

function titleFromPath(path: string) {
  const fileName = path.split(/[\\/]/).pop() ?? '';
  return fileName
    .replace(/\.pdf$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
