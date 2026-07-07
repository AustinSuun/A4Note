import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { buildPaperRelationView, getObjectNavigationTarget, type AnnotationTrace, type ObjectNavigationTarget } from '../../core/relations';
import type { AiThreadContext, PaperDocument } from '../../core/types';
import type { PaperFileKind } from '../../platform/nativeApi';
import { zh } from '../../ui/zh';
import { annotationLabelText, preferredTranslatedFileId } from './readerHelpers';

export function RelationPanel({
  paper,
  fileMode,
  translatedFileId,
  aiThreadContexts,
  onNavigateTarget,
}: {
  paper: PaperDocument;
  fileMode: PaperFileKind;
  translatedFileId: string;
  aiThreadContexts: AiThreadContext[];
  onNavigateTarget: (target: ObjectNavigationTarget | null) => void;
}) {
  const currentFileId = fileMode === 'translated' ? preferredTranslatedFileId(paper, translatedFileId) : paper.sourceFileId;
  const relationView = useMemo(() => buildPaperRelationView(paper, { currentFileId, aiThreadContexts }), [paper, currentFileId, aiThreadContexts]);
  const annotationById = useMemo(() => new Map(paper.annotations.map((annotation) => [annotation.id, annotation])), [paper.annotations]);
  const currentFileAnnotations = relationView.currentFileAnnotations
    .map((trace) => ({
      trace,
      annotation: annotationById.get(String(trace.annotation.metadata.originalId)),
    }))
    .filter((item): item is { trace: AnnotationTrace; annotation: PaperDocument['annotations'][number] } => Boolean(item.annotation));

  return (
    <div className="relation-panel">
      <div>
        <div className="panel-title">{zh.reader.panelRelations}</div>
        <p className="detail-muted">{zh.reader.relationSummary(relationView.graph.objects.length, relationView.graph.relations.length)}</p>
      </div>
      <RelationSection title={zh.reader.relationFiles}>
        {relationView.files.map(({ object }) => (
          <RelationRow
            key={object.id}
            label={String(object.metadata.fileKind) === 'translated' ? zh.reader.translatedPdf : zh.reader.sourcePdf}
            value={object.title}
            meta={String(object.metadata.path || '')}
            onClick={() => onNavigateTarget(getObjectNavigationTarget(object))}
          />
        ))}
      </RelationSection>
      <RelationSection title={zh.reader.relationNotes}>
        {relationView.notes.length ? (
          relationView.notes.map(({ object }) => (
            <RelationRow
              key={object.id}
              label={object.title}
              value={String(object.metadata.format || 'Markdown')}
              meta={object.summary || ''}
              onClick={() => onNavigateTarget(getObjectNavigationTarget(object))}
            />
          ))
        ) : (
          <div className="mini-message">{zh.reader.relationNoNotes}</div>
        )}
      </RelationSection>
      <RelationSection title={zh.reader.relationAnnotations}>
        {currentFileAnnotations.length ? (
          currentFileAnnotations.slice(0, 12).map(({ trace, annotation }) => (
            <button key={annotation.id} type="button" className="relation-row clickable" onClick={() => onNavigateTarget(getObjectNavigationTarget(trace.annotation))}>
              <span>{zh.reader.annotationPage(annotation.page)}</span>
              <strong>{annotation.quote || annotation.comment || annotationLabelText(annotation.type)}</strong>
              <em>{annotationLabelText(annotation.type)}</em>
            </button>
          ))
        ) : (
          <div className="mini-message">{zh.reader.relationNoAnnotations}</div>
        )}
        {currentFileAnnotations.length > 12 && <div className="detail-muted">{zh.reader.relationMoreAnnotations(currentFileAnnotations.length - 12)}</div>}
      </RelationSection>
      <RelationSection title={zh.reader.relationAiThreads}>
        {relationView.aiThreads.length ? (
          relationView.aiThreads.map(({ object }) => (
            <RelationRow key={object.id} label={object.title} value={zh.ai.provider} meta={String(object.metadata.originalId || '')} onClick={() => onNavigateTarget(getObjectNavigationTarget(object))} />
          ))
        ) : (
          <div className="mini-message">{zh.reader.relationNoAi}</div>
        )}
      </RelationSection>
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

function RelationRow({ label, value, meta, onClick }: { label: string; value: string; meta?: string; onClick?: () => void }) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value || '-'}</strong>
      {meta ? <em>{meta}</em> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="relation-row clickable" onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className="relation-row">{content}</div>;
}
