import { useState } from 'react';
import type { ImportDraft } from '../../core/types';
import { zh } from '../../ui/zh';
import { TagInput } from './TagInput';
import type { ImportDialogProps, ImportMetadataSourcePreference, ImportState } from './types';

export function ImportDialog({
  draft,
  suggestions,
  state,
  settings,
  onChangeDraft,
  onSelectPdf,
  onRegenerate,
  onClose,
  onConfirm,
}: ImportDialogProps) {
  const [enrichState, setEnrichState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const update = (field: keyof ImportDraft, value: string) => {
    onChangeDraft({ ...draft, [field]: field === 'year' ? Number(value) || '' : value, extractionSource: 'manual' });
  };
  const enrichOnline = async () => {
    setEnrichState('loading');
    try {
      const enriched = await enrichImportDraftOnline(draft, settings.metadataSourcePreference);
      onChangeDraft({
        ...draft,
        ...enriched,
        tags: draft.tags,
        extractionSource: 'manual',
        metadataSource: enriched.metadataSource,
        extractionWarnings: [...(draft.extractionWarnings ?? []), zh.importDialog.onlineSuccess(enriched.metadataSource)],
      });
      setEnrichState('success');
    } catch (error) {
      console.error('Online metadata enrichment failed', error);
      onChangeDraft({
        ...draft,
        extractionWarnings: [...(draft.extractionWarnings ?? []), zh.importDialog.onlineFailed],
      });
      setEnrichState('error');
    }
  };
  const sourceLabel = draft.extractionSource === 'pdf_text' ? zh.importDialog.sourcePdfText : draft.extractionSource === 'manual' ? zh.importDialog.sourceManual : zh.importDialog.sourceFilename;
  return (
    <div className="modal-backdrop">
      <section className="import-dialog import-dialog-large">
        <header>
          <div>
            <p className="eyebrow">{zh.importDialog.eyebrow}</p>
            <h2>{zh.importDialog.title}</h2>
          </div>
          <button type="button" className="rounded-button subtle-button" onClick={onClose}>
            {zh.importDialog.close}
          </button>
        </header>
        <div className="import-steps">
          <div className={draft.originalPath ? 'import-step done' : 'import-step active'}>{zh.importDialog.selectStep}</div>
          <div className={state === 'extracting' ? 'import-step active' : draft.originalPath ? 'import-step done' : 'import-step'}>{zh.importDialog.extractStep}</div>
          <div className={state === 'ready' || state === 'error' ? 'import-step active' : 'import-step'}>{zh.importDialog.confirmStep}</div>
        </div>
        <div className="pdf-select-block">
          <div>
            <strong>{draft.originalPath ? zh.importDialog.selectedFile : zh.importDialog.noFile}</strong>
            <span>{draft.originalPath || zh.importDialog.idle}</span>
          </div>
          <button type="button" className="primary choose-pdf-button rounded-button" onClick={() => void onSelectPdf()} disabled={state === 'selecting' || state === 'extracting' || state === 'importing'}>
            {draft.originalPath ? zh.importDialog.chooseAnother : zh.importDialog.choosePdf}
          </button>
        </div>
        <div className={`import-status ${state}`}>
          <span>{importStatusText(state)}</span>
          {draft.originalPath && <strong>{sourceLabel}</strong>}
        </div>
        <div className="import-grid">
          <label className="wide">
            {zh.importDialog.titleField}
            <input value={draft.title} onChange={(event) => update('title', event.target.value)} />
          </label>
          <label>
            {zh.importDialog.authors}
            <input value={draft.authors} onChange={(event) => update('authors', event.target.value)} placeholder={zh.importDialog.optional} />
          </label>
          <label>
            {zh.importDialog.year}
            <input value={draft.year} onChange={(event) => update('year', event.target.value)} />
          </label>
          <label>
            {zh.importDialog.venue}
            <input value={draft.venue} onChange={(event) => update('venue', event.target.value)} placeholder={zh.importDialog.optional} />
          </label>
          <label>
            {zh.importDialog.doi}
            <input value={draft.doi} onChange={(event) => update('doi', event.target.value)} placeholder={zh.importDialog.optionalDoi} />
          </label>
          <label className="wide">
            {zh.importDialog.tags}
            <TagInput
              value={draft.tags}
              suggestions={suggestions}
              placeholder={zh.importDialog.tagsPlaceholder}
              onChange={(tags) =>
                onChangeDraft({
                  ...draft,
                  tags,
                  extractionSource: 'manual',
                })
              }
            />
          </label>
        </div>
        {!!draft.extractionWarnings?.length && (
          <div className="import-warnings">
            {draft.extractionWarnings.map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </div>
        )}
        <div className="import-hint">{zh.importDialog.hint}</div>
        <footer>
          <button type="button" className="rounded-button subtle-button" onClick={() => void onRegenerate()} disabled={!draft.originalPath || state === 'extracting' || state === 'importing'}>
            {zh.importDialog.regenerate}
          </button>
          <button
            type="button"
            className="rounded-button subtle-button"
            onClick={() => void enrichOnline()}
            disabled={!draft.originalPath || !settings.onlineMetadataEnabled || settings.metadataSourcePreference === 'localOnly' || enrichState === 'loading' || state === 'importing'}
            title={!settings.onlineMetadataEnabled || settings.metadataSourcePreference === 'localOnly' ? zh.importDialog.onlineDisabled : zh.importDialog.onlineEnrich}
          >
            {enrichState === 'loading' ? zh.importDialog.onlineLoading : zh.importDialog.onlineEnrich}
          </button>
          <button type="button" className="primary rounded-button" onClick={onConfirm} disabled={!draft.originalPath || state === 'extracting' || state === 'importing'}>
            {state === 'importing' ? zh.importDialog.importing : zh.importDialog.confirm}
          </button>
        </footer>
      </section>
    </div>
  );
}

function importStatusText(state: ImportState) {
  if (state === 'selecting') return zh.importDialog.selecting;
  if (state === 'extracting') return zh.importDialog.extracting;
  if (state === 'ready') return zh.importDialog.ready;
  if (state === 'error') return zh.importDialog.error;
  if (state === 'importing') return zh.importDialog.importing;
  return zh.importDialog.idle;
}

async function enrichImportDraftOnline(draft: ImportDraft, preference: ImportMetadataSourcePreference): Promise<Partial<ImportDraft> & { metadataSource: string }> {
  if (preference === 'localOnly') throw new Error('Online metadata disabled');
  const arxivId = findArxivId([draft.doi, draft.title, draft.originalPath].join(' '));
  if (preference === 'arxivFirst' && arxivId) {
    const arxiv = await fetchArxivMetadata(arxivId);
    if (arxiv) return arxiv;
  }
  const crossref = await fetchCrossrefMetadata(draft);
  if (crossref) return crossref;
  if (arxivId) {
    const arxiv = await fetchArxivMetadata(arxivId);
    if (arxiv) return arxiv;
  }
  throw new Error('No online metadata found');
}

async function fetchCrossrefMetadata(draft: ImportDraft): Promise<(Partial<ImportDraft> & { metadataSource: string }) | null> {
  const doi = draft.doi.trim();
  const endpoint = doi
    ? `https://api.crossref.org/works/${encodeURIComponent(doi)}`
    : `https://api.crossref.org/works?rows=1&query.title=${encodeURIComponent(draft.title.trim())}`;
  if (!doi && !draft.title.trim()) return null;
  const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  const data = await response.json();
  const work = doi ? data?.message : data?.message?.items?.[0];
  if (!work) return null;
  const title = Array.isArray(work.title) ? work.title[0] : '';
  if (!doi && !isLikelySameTitle(draft.title, title)) return null;
  const authors = Array.isArray(work.author)
    ? work.author
        .slice(0, 8)
        .map((author: { given?: string; family?: string }) => [author.given, author.family].filter(Boolean).join(' '))
        .filter(Boolean)
        .join(', ')
    : '';
  const year = work.published?.['date-parts']?.[0]?.[0] ?? work.created?.['date-parts']?.[0]?.[0] ?? '';
  const venue = Array.isArray(work['container-title']) ? work['container-title'][0] : '';
  return {
    title: title || draft.title,
    authors: authors || draft.authors,
    year: typeof year === 'number' ? year : draft.year,
    venue: venue || draft.venue,
    doi: work.DOI || draft.doi,
    metadataSource: 'Crossref',
  };
}

async function fetchArxivMetadata(arxivId: string): Promise<(Partial<ImportDraft> & { metadataSource: string }) | null> {
  const response = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`);
  if (!response.ok) return null;
  const xml = await response.text();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const entry = doc.querySelector('entry');
  if (!entry) return null;
  const title = entry.querySelector('title')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const authors = Array.from(entry.querySelectorAll('author > name'))
    .map((node) => node.textContent?.trim())
    .filter(Boolean)
    .join(', ');
  const published = entry.querySelector('published')?.textContent ?? '';
  const year = Number(published.slice(0, 4)) || '';
  return {
    title,
    authors,
    year,
    venue: 'arXiv',
    doi: `arXiv:${arxivId}`,
    metadataSource: 'arXiv',
  };
}

function findArxivId(text: string) {
  const match = text.match(/(?:arxiv:)?(\d{4}\.\d{4,5})(?:v\d+)?/i);
  return match?.[1] ?? '';
}

function isLikelySameTitle(inputTitle: string, candidateTitle: string) {
  const inputWords = normalizedTitleWords(inputTitle);
  const candidateWords = normalizedTitleWords(candidateTitle);
  if (inputWords.length < 2 || candidateWords.length < 2) return Boolean(candidateTitle);
  const candidateSet = new Set(candidateWords);
  const overlap = inputWords.filter((word) => candidateSet.has(word)).length;
  return overlap >= Math.min(2, inputWords.length);
}

function normalizedTitleWords(title: string) {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !['the', 'and', 'for', 'with', 'from'].includes(word));
}
