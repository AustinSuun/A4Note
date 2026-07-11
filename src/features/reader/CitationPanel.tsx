import { useState } from 'react';
import type { ObjectNavigationTarget } from '../../core/relations';
import type { AnnotationColor, AiThreadContext, PaperDocument, PositionJson } from '../../core/types';
import type { PaperFileKind } from '../../platform/nativeApi';
import { AnnotationListPanel } from './AnnotationListPanel';
import { RelationPanel } from './RelationPanel';

/** 引用 tab：包含标注列表和文献关系两个可折叠区 */
export function CitationPanel({
  paper,
  fileMode,
  translatedFileId,
  aiThreadContexts,
  focusedAnnotationId,
  onFocusAnnotation,
  onUpdateAnnotationComment,
  onUpdateAnnotationPosition,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onAppendAnnotationToNote,
  onNavigateAnnotation,
  onNavigateRelationTarget,
}: {
  paper: PaperDocument;
  fileMode: PaperFileKind;
  translatedFileId: string;
  aiThreadContexts: AiThreadContext[];
  focusedAnnotationId: string | null;
  onFocusAnnotation: (annotationId: string | null) => void;
  onUpdateAnnotationComment: (annotationId: string, comment: string) => void | Promise<void>;
  onUpdateAnnotationPosition: (annotationId: string, positionJson: PositionJson) => void | Promise<void>;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  onAppendAnnotationToNote: (annotationId: string) => void;
  onNavigateAnnotation: (annotationId: string) => void;
  onNavigateRelationTarget: (target: ObjectNavigationTarget | null) => void;
}) {
  const [annotationsOpen, setAnnotationsOpen] = useState(true);
  const [relationsOpen, setRelationsOpen] = useState(false);

  return (
    <div className="citation-panel">
      {/* 标注列表区 */}
      <div className="citation-section">
        <button className="citation-section-header" type="button" onClick={() => setAnnotationsOpen((v) => !v)}>
          <span className="citation-section-icon">{annotationsOpen ? '▾' : '▸'}</span>
          <span>标注</span>
          <span className="citation-section-count">{paper.annotations.length}</span>
        </button>
        {annotationsOpen && (
          <div className="citation-section-body">
            <AnnotationListPanel
              paper={paper}
              fileMode={fileMode}
              translatedFileId={translatedFileId}
              focusedAnnotationId={focusedAnnotationId}
              onFocusAnnotation={onFocusAnnotation}
              onUpdateAnnotationComment={onUpdateAnnotationComment}
              onUpdateAnnotationPosition={onUpdateAnnotationPosition}
              onUpdateAnnotationColor={onUpdateAnnotationColor}
              onDeleteAnnotation={onDeleteAnnotation}
              onAppendToNote={onAppendAnnotationToNote}
            />
          </div>
        )}
      </div>

      {/* 文献关系区 */}
      <div className="citation-section">
        <button className="citation-section-header" type="button" onClick={() => setRelationsOpen((v) => !v)}>
          <span className="citation-section-icon">{relationsOpen ? '▾' : '▸'}</span>
          <span>关系</span>
        </button>
        {relationsOpen && (
          <div className="citation-section-body">
            <RelationPanel
              paper={paper}
              fileMode={fileMode}
              translatedFileId={translatedFileId}
              aiThreadContexts={aiThreadContexts}
              onNavigateTarget={onNavigateRelationTarget}
            />
          </div>
        )}
      </div>
    </div>
  );
}
