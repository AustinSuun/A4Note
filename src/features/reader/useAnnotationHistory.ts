import { useRef, useState } from 'react';
import type { createAsterCore } from '../../core/asterCore';
import type { AnnotationColor, AnnotationDraft, PaperDocument, PositionJson } from '../../core/types';
import { preferredTranslatedFileId } from './readerHelpers';
import {
  createNativeAnnotation,
  deleteNativeAnnotation,
  isTauriRuntime,
  restoreNativeAnnotation,
  updateNativeAnnotationColor,
  updateNativeAnnotationComment,
  updateNativeAnnotationPosition,
  type PaperFileKind,
} from '../../platform/nativeApi';
import { zh } from '../../ui/zh';

type AsterCore = ReturnType<typeof createAsterCore>;

export type AnnotationHistoryAction =
  | { kind: 'create'; annotation: PaperDocument['annotations'][number] }
  | { kind: 'delete'; annotation: PaperDocument['annotations'][number] }
  | { kind: 'updateComment'; annotationId: string; previous: string; next: string }
  | { kind: 'updateColor'; annotationId: string; previous: string; next: string }
  | { kind: 'updatePosition'; annotationId: string; previous: PositionJson; next: PositionJson };

export function useAnnotationHistory({
  aster,
  selectedPaper,
  readerFileMode,
  readerTranslatedFileId,
  setReaderFocusedAnnotationId,
  setRevision,
  setLibraryStatus,
}: {
  aster: AsterCore;
  selectedPaper: PaperDocument | null;
  readerFileMode: PaperFileKind;
  readerTranslatedFileId: string;
  setReaderFocusedAnnotationId: (value: string | null | ((current: string | null) => string | null)) => void;
  setRevision: (value: number | ((current: number) => number)) => void;
  setLibraryStatus: (status: string) => void;
}) {
  const [annotationUndoStack, setAnnotationUndoStack] = useState<AnnotationHistoryAction[]>([]);
  const [annotationRedoStack, setAnnotationRedoStack] = useState<AnnotationHistoryAction[]>([]);
  const deletingAnnotationIdsRef = useRef(new Set<string>());
  const annotationPersistenceQueueRef = useRef<Promise<void>>(Promise.resolve());

  const queueAnnotationPersistence = (operation: () => Promise<void>) => {
    const next = annotationPersistenceQueueRef.current.then(operation, operation);
    annotationPersistenceQueueRef.current = next.catch((error) => {
      console.error('Annotation persistence queue failed', error);
    });
    return next;
  };

  const persistHistoryAction = (action: AnnotationHistoryAction, direction: 'undo' | 'redo') => {
    if (!isTauriRuntime()) return;
    try {
      if (action.kind === 'create') {
        if (direction === 'undo') void queueAnnotationPersistence(() => deleteNativeAnnotation(action.annotation.id).then(() => undefined));
        else void queueAnnotationPersistence(() => restoreNativeAnnotation(action.annotation).then(() => undefined));
        return;
      }
      if (action.kind === 'delete') {
        if (direction === 'undo') void queueAnnotationPersistence(() => restoreNativeAnnotation(action.annotation).then(() => undefined));
        else void queueAnnotationPersistence(() => deleteNativeAnnotation(action.annotation.id).then(() => undefined));
        return;
      }
      if (action.kind === 'updateComment') {
        void queueAnnotationPersistence(() =>
          updateNativeAnnotationComment({ annotationId: action.annotationId, comment: direction === 'undo' ? action.previous : action.next }).then(() => undefined),
        );
        return;
      }
      if (action.kind === 'updateColor') {
        void queueAnnotationPersistence(() =>
          updateNativeAnnotationColor({ annotationId: action.annotationId, color: direction === 'undo' ? action.previous : action.next }).then(() => undefined),
        );
        return;
      }
      if (action.kind === 'updatePosition') {
        void queueAnnotationPersistence(() =>
          updateNativeAnnotationPosition({ annotationId: action.annotationId, positionJson: direction === 'undo' ? action.previous : action.next }).then(() => undefined),
        );
      }
    } catch (error) {
      console.error('Failed to persist annotation history action', error);
    }
  };

  const restoreAnnotation = (annotation: PaperDocument['annotations'][number]) => {
    const paper = aster.documents.get(annotation.paperId);
    if (!paper || paper.annotations.some((item) => item.id === annotation.id)) return;
    paper.annotations = [...paper.annotations, cloneAnnotation(annotation)].sort((a, b) => a.page - b.page || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    setReaderFocusedAnnotationId(annotation.id);
    setRevision((current) => current + 1);
  };

  const removeLocalAnnotation = (annotation: PaperDocument['annotations'][number]) => {
    const paper = aster.documents.get(annotation.paperId);
    if (!paper) return;
    paper.annotations = paper.annotations.filter((item) => item.id !== annotation.id);
    setReaderFocusedAnnotationId((current) => (current === annotation.id ? null : current));
    setRevision((current) => current + 1);
  };

  const updateLocalAnnotation = (annotationId: string, patch: Partial<PaperDocument['annotations'][number]>) => {
    const paper = selectedPaper ? aster.documents.get(selectedPaper.paperId) : null;
    const annotation = paper?.annotations.find((item) => item.id === annotationId);
    if (!annotation) return;
    const safePatch = patch.positionJson ? { ...patch, positionJson: clonePositionJson(patch.positionJson) } : patch;
    Object.assign(annotation, safePatch);
    setReaderFocusedAnnotationId(annotationId);
    setRevision((current) => current + 1);
  };

  const applyAnnotationHistoryAction = (action: AnnotationHistoryAction, direction: 'undo' | 'redo') => {
    if (action.kind === 'create') {
      if (direction === 'undo') removeLocalAnnotation(action.annotation);
      else restoreAnnotation(action.annotation);
      persistHistoryAction(action, direction);
      return;
    }
    if (action.kind === 'delete') {
      if (direction === 'undo') restoreAnnotation(action.annotation);
      else removeLocalAnnotation(action.annotation);
      persistHistoryAction(action, direction);
      return;
    }
    if (action.kind === 'updateComment') {
      updateLocalAnnotation(action.annotationId, { comment: direction === 'undo' ? action.previous : action.next });
      persistHistoryAction(action, direction);
      return;
    }
    if (action.kind === 'updateColor') {
      updateLocalAnnotation(action.annotationId, { color: direction === 'undo' ? action.previous : action.next });
      persistHistoryAction(action, direction);
      return;
    }
    if (action.kind === 'updatePosition') {
      updateLocalAnnotation(action.annotationId, { positionJson: direction === 'undo' ? action.previous : action.next });
      persistHistoryAction(action, direction);
    }
  };

  const undoAnnotationAction = () => {
    const action = annotationUndoStack[annotationUndoStack.length - 1];
    if (!action) return;
    setAnnotationUndoStack((current) => current.slice(0, -1));
    setAnnotationRedoStack((current) => [...current.slice(-39), action]);
    applyAnnotationHistoryAction(action, 'undo');
  };

  const redoAnnotationAction = () => {
    const action = annotationRedoStack[annotationRedoStack.length - 1];
    if (!action) return;
    setAnnotationRedoStack((current) => current.slice(0, -1));
    setAnnotationUndoStack((current) => [...current.slice(-39), action]);
    applyAnnotationHistoryAction(action, 'redo');
  };

  const pushAnnotationHistory = (action: AnnotationHistoryAction) => {
    setAnnotationUndoStack((current) => [...current.slice(-39), action]);
    setAnnotationRedoStack([]);
  };

  const createAnnotation = async (annotation: AnnotationDraft & { page: number }, fileKind = readerFileMode) => {
    if (!selectedPaper) return;
    const fileId = fileKind === 'translated' ? preferredTranslatedFileId(selectedPaper, readerTranslatedFileId) : selectedPaper.sourceFileId;
    if (isTauriRuntime() && fileId) {
      try {
        const { page, ...annotationPayload } = annotation;
        const created = await createNativeAnnotation({ paperId: selectedPaper.paperId, fileId, page, ...annotationPayload });
        const localPaper = aster.documents.get(selectedPaper.paperId);
        const nextAnnotation = {
          id: created.id,
          paperId: selectedPaper.paperId,
          fileId,
          page,
          ...annotationPayload,
          createdAt: new Date().toISOString(),
        };
        if (localPaper && !localPaper.annotations.some((item) => item.id === created.id)) {
          localPaper.annotations = [...localPaper.annotations, nextAnnotation].sort(
            (left, right) => left.page - right.page || (left.createdAt ?? '').localeCompare(right.createdAt ?? ''),
          );
        }
        pushAnnotationHistory({ kind: 'create', annotation: cloneAnnotation(nextAnnotation) });
        setRevision((current) => current + 1);
        return created.id;
      } catch (error) {
        console.error('Annotation create failed', error);
        setLibraryStatus(zh.reader.annotationCreateFailed);
        throw error;
      }
    }
    const annotationForFile = { ...annotation, fileId };
    const created = aster.commands.execute<unknown, { id: string } | null>('document.addAnnotation', { paperId: selectedPaper.paperId, annotation: annotationForFile });
    if (created?.id) {
      const localPaper = aster.documents.get(selectedPaper.paperId);
      const createdAnnotation = localPaper?.annotations.find((item) => item.id === created.id);
      if (createdAnnotation) pushAnnotationHistory({ kind: 'create', annotation: cloneAnnotation(createdAnnotation) });
    }
    setRevision((current) => current + 1);
    return created?.id;
  };

  const updateAnnotationComment = async (annotationId: string, comment: string) => {
    if (!selectedPaper) return;
    const localPaper = aster.documents.get(selectedPaper.paperId);
    const annotation = localPaper?.annotations.find((item) => item.id === annotationId);
    if (!annotation) return;
    const previousComment = annotation.comment ?? '';
    if (previousComment === comment) return;
    pushAnnotationHistory({ kind: 'updateComment', annotationId, previous: previousComment, next: comment });
    annotation.comment = comment;
    setRevision((current) => current + 1);
    if (isTauriRuntime()) {
      try {
        await queueAnnotationPersistence(() => updateNativeAnnotationComment({ annotationId, comment }).then(() => undefined));
        return;
      } catch (error) {
        annotation.comment = previousComment;
        setRevision((current) => current + 1);
        console.error('Annotation comment update failed', error);
        setLibraryStatus(zh.reader.annotationSaveFailed);
        throw error;
      }
    }
  };

  const updateAnnotationColor = async (annotationId: string, color: AnnotationColor) => {
    if (!selectedPaper) return;
    const localPaper = aster.documents.get(selectedPaper.paperId);
    const annotation = localPaper?.annotations.find((item) => item.id === annotationId);
    if (!annotation) return;
    const previousColor = annotation.color ?? '';
    if (previousColor === color) return;
    pushAnnotationHistory({ kind: 'updateColor', annotationId, previous: previousColor, next: color });
    annotation.color = color;
    setRevision((current) => current + 1);
    if (isTauriRuntime()) {
      try {
        await queueAnnotationPersistence(() => updateNativeAnnotationColor({ annotationId, color }).then(() => undefined));
        return;
      } catch (error) {
        annotation.color = previousColor;
        setRevision((current) => current + 1);
        console.error('Annotation color update failed', error);
        setLibraryStatus(zh.reader.annotationSaveFailed);
        throw error;
      }
    }
  };

  const updateAnnotationPosition = async (annotationId: string, positionJson: PositionJson) => {
    if (!selectedPaper) return;
    const localPaper = aster.documents.get(selectedPaper.paperId);
    const annotation = localPaper?.annotations.find((item) => item.id === annotationId);
    if (!annotation) return;
    const previousPosition = clonePositionJson(annotation.positionJson);
    const nextPosition = clonePositionJson(positionJson);
    if (JSON.stringify(previousPosition) === JSON.stringify(nextPosition)) return;
    pushAnnotationHistory({ kind: 'updatePosition', annotationId, previous: clonePositionJson(previousPosition), next: clonePositionJson(nextPosition) });
    annotation.positionJson = clonePositionJson(nextPosition);
    setRevision((current) => current + 1);
    if (isTauriRuntime()) {
      try {
        await queueAnnotationPersistence(() => updateNativeAnnotationPosition({ annotationId, positionJson: nextPosition }).then(() => undefined));
        return;
      } catch (error) {
        annotation.positionJson = clonePositionJson(previousPosition);
        setRevision((current) => current + 1);
        console.error('Annotation position update failed', error);
        setLibraryStatus(zh.reader.annotationSaveFailed);
        throw error;
      }
    }
  };

  const deleteAnnotation = async (annotationId: string) => {
    if (!selectedPaper) return;
    if (deletingAnnotationIdsRef.current.has(annotationId)) return;
    const localPaper = aster.documents.get(selectedPaper.paperId);
    const removedAnnotation = localPaper?.annotations.find((annotation) => annotation.id === annotationId) ?? null;
    if (!removedAnnotation) return;
    const removedSnapshot = cloneAnnotation(removedAnnotation);
    deletingAnnotationIdsRef.current.add(annotationId);
    if (isTauriRuntime()) {
      try {
        await queueAnnotationPersistence(() => deleteNativeAnnotation(annotationId).then(() => undefined));
      } catch (error) {
        console.error('Annotation delete failed', error);
        setLibraryStatus(zh.reader.annotationDeleteFailed);
        deletingAnnotationIdsRef.current.delete(annotationId);
        throw error;
      }
    }
    pushAnnotationHistory({ kind: 'delete', annotation: removedSnapshot });
    if (localPaper) {
      localPaper.annotations = localPaper.annotations.filter((annotation) => annotation.id !== annotationId);
      setReaderFocusedAnnotationId((current) => (current === annotationId ? null : current));
      setRevision((current) => current + 1);
    }
    deletingAnnotationIdsRef.current.delete(annotationId);
  };

  const clearAnnotationHistory = () => {
    setAnnotationUndoStack([]);
    setAnnotationRedoStack([]);
  };

  return {
    annotationUndoStack,
    annotationRedoStack,
    undoAnnotationAction,
    redoAnnotationAction,
    createAnnotation,
    updateAnnotationComment,
    updateAnnotationColor,
    updateAnnotationPosition,
    deleteAnnotation,
    clearAnnotationHistory,
  };
}

function clonePositionJson(positionJson: PositionJson): PositionJson {
  return JSON.parse(JSON.stringify(positionJson)) as PositionJson;
}

function cloneAnnotation(annotation: PaperDocument['annotations'][number]): PaperDocument['annotations'][number] {
  return {
    ...annotation,
    positionJson: clonePositionJson(annotation.positionJson),
  };
}
