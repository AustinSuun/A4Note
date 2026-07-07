import { type ReactNode, useMemo } from 'react';
import { buildPaperRelationView, type AnnotationTrace } from '../../core/relations';
import type { AnnotationType, KnowledgeObject, Relation } from '../../core/types';
import { zh } from '../../ui/zh';
import type { LibraryDetailPanelProps } from './types';

export function LibraryDetailPanel({
  paper,
  aiThreadContexts,
  onOpenReader,
  onOpenRelations,
  onOpenTranslationImport,
  onRevealSourcePdf,
  onRevealTranslatedPdf,
  onOpenSourcePdfExternal,
  onOpenTranslatedPdfExternal,
  onOpenMetadataEdit,
  onOpenTagsEdit,
  onCopyBibtex,
}: LibraryDetailPanelProps) {
  const relationView = useMemo(() => buildPaperRelationView(paper, { aiThreadContexts }), [paper, aiThreadContexts]);
  return (
    <div className="library-detail-content">
      <h2>{paper.title}</h2>
      <div className="detail-muted">{paper.authors || zh.library.unknownAuthors}</div>
      <div className="detail-meta-grid">
        <DetailItem label={zh.library.tableYear} value={paper.year || '-'} />
        <DetailItem label={zh.library.tableVenue} value={paper.venue || zh.library.unknownVenue} />
        <DetailItem label={zh.editDialog.doi} value={paper.doi || '-'} />
      </div>
      <div className="detail-section">
        <div className="panel-title">{zh.library.files}</div>
        <div className="binding-row">
          <span>{zh.reader.sourcePdf}</span>
          <strong>{paper.sourcePdf ? zh.library.bound : zh.library.unbound}</strong>
          <button type="button" onClick={onRevealSourcePdf} disabled={!paper.sourcePdf}>
            {zh.library.revealFile}
          </button>
          <button type="button" onClick={onOpenSourcePdfExternal} disabled={!paper.sourcePdf}>
            {zh.library.openExternal}
          </button>
        </div>
        <div className="binding-row">
          <span>{zh.reader.translatedPdf}</span>
          <strong>{paper.translatedPdfs.length ? zh.library.translationCount(paper.translatedPdfs.length) : zh.library.unbound}</strong>
          <button type="button" onClick={onRevealTranslatedPdf} disabled={!paper.translatedPdfs.length}>
            {zh.library.revealFile}
          </button>
          <button type="button" onClick={onOpenTranslatedPdfExternal} disabled={!paper.translatedPdfs.length}>
            {zh.library.openExternal}
          </button>
        </div>
      </div>
      <div className="detail-section">
        <div className="panel-title">{zh.library.bindings}</div>
        <div className="binding-stats">
          <span>{zh.library.noteCount(paper.notes.length)}</span>
          <span>{zh.library.annotationCount(paper.annotations.length)}</span>
          <span>{zh.library.aiThreadCount(paper.aiThreads.length)}</span>
        </div>
      </div>
      <div className="detail-section">
        <div className="panel-title">{zh.library.relations}</div>
        <div className="binding-stats">
          <span>{zh.library.objectCount(relationView.graph.objects.length)}</span>
          <span>{zh.library.relationCount(relationView.graph.relations.length)}</span>
          <span>{zh.library.fileObjectCount(relationView.files.length)}</span>
        </div>
        <RelationSection title={zh.library.relationPreview}>
          {relationView.previewRelations.length ? (
            relationView.previewRelations.map(({ relation, source, target, annotationTrace }) => (
              <RelationRow
                key={relation.id}
                label={relationTypeLabel(relation.type)}
                value={formatRelationEndpoints(source, target, relation)}
                meta={formatRelationMeta(relation, annotationTrace)}
              />
            ))
          ) : (
            <div className="mini-message">{zh.library.relationPreviewEmpty}</div>
          )}
          {relationView.previewMoreCount > 0 ? <div className="detail-muted">{zh.library.relationMore(relationView.previewMoreCount)}</div> : null}
        </RelationSection>
      </div>
      <div className="detail-section">
        <div className="panel-title">{zh.library.tags}</div>
        <div className="tag-row detail-tags">
          {paper.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      </div>
      <div className="detail-actions">
        <button type="button" className="primary rounded-button" onClick={onOpenReader}>
          {zh.library.openReader}
        </button>
        <button type="button" onClick={onOpenRelations}>
          {zh.library.viewRelations}
        </button>
        <button type="button" onClick={onOpenTranslationImport}>
          {zh.library.importTranslationPdf}
        </button>
        <button type="button" onClick={onOpenMetadataEdit}>
          {zh.library.edit}
        </button>
        <button type="button" onClick={onOpenTagsEdit}>
          {zh.library.tagsEdit}
        </button>
        <button type="button" onClick={onCopyBibtex}>
          {zh.library.copyBibtex}
        </button>
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RelationSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="relation-section">
      <div className="relation-section-title">{title}</div>
      <div className="relation-section-body">{children}</div>
    </section>
  );
}

function RelationRow({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="relation-row">
      <span>{label}</span>
      <strong>{value || '-'}</strong>
      {meta ? <em>{meta}</em> : null}
    </div>
  );
}

function relationTypeLabel(type: Relation['type']) {
  switch (type) {
    case 'attached_file':
      return 'Attached file';
    case 'has_note':
      return 'Note';
    case 'annotates':
      return 'Annotation';
    case 'excerpted_from':
      return 'Excerpt';
    case 'discusses':
      return 'AI discussion';
    case 'derived_from':
      return 'Derived from';
    case 'contains':
      return 'Contains';
    case 'cites':
      return 'Citation';
    case 'links_to':
      return 'Link';
    case 'related_to':
      return 'Related';
    case 'generated_from':
      return 'Generated from';
    case 'version_of':
      return 'Version';
    case 'tagged_with':
      return 'Tag';
    default:
      return type;
  }
}

function formatRelationEndpoints(source: KnowledgeObject | null, target: KnowledgeObject | null, relation: Relation) {
  return `${source?.title ?? relation.sourceObjectId} -> ${target?.title ?? relation.targetObjectId}`;
}

function formatRelationMeta(relation: Relation, annotationTrace: AnnotationTrace | null = null) {
  const meta: string[] = [];
  if (typeof relation.metadata.fileKind === 'string') {
    meta.push(relation.metadata.fileKind === 'translated' ? zh.reader.translatedPdf : zh.reader.sourcePdf);
  }
  const page = annotationTrace?.page ?? relation.metadata.page;
  if (typeof page === 'number') {
    meta.push(zh.reader.annotationPage(page));
  }
  if (typeof relation.metadata.annotationType === 'string') {
    meta.push(annotationLabelText(relation.metadata.annotationType as AnnotationType));
  }
  if (annotationTrace?.noteLinks.length) {
    meta.push(zh.library.noteCount(annotationTrace.noteLinks.length));
  }
  return meta.join(' - ');
}

function annotationLabelText(type: AnnotationType) {
  if (type === 'comment') return zh.reader.commentLabel;
  if (type === 'underline') return zh.reader.underlineLabel;
  if (type === 'area') return zh.reader.areaLabel;
  return zh.reader.highlightLabel;
}
