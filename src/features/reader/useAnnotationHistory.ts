import { reportReaderSaveError } from './readerSaveErrors';
import { useEffect, useRef, useState } from 'react';
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
  // Keep independent histories per paper; all model/history commits share one write queue.
  type HistoryScope = { paperId: string; undo: AnnotationHistoryAction[]; redo: AnnotationHistoryAction[] };
  const scopes = useRef(new Map<string, HistoryScope>());
  const activeScope = useRef<HistoryScope | null>(null);
  const [, setHistoryRevision] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const paperId = selectedPaper?.paperId ?? '';
  if (paperId && !scopes.current.has(paperId)) scopes.current.set(paperId, { paperId, undo: [], redo: [] });
  const scope = paperId ? scopes.current.get(paperId)! : null;
  activeScope.current = scope;
  const annotationUndoStack = scope?.undo ?? [];
  const annotationRedoStack = scope?.redo ?? [];
  const annotationPersistenceQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const publish = (owner: HistoryScope) => {
    if (!mounted.current) return;
    setRevision((current) => current + 1);
    if (activeScope.current === owner) setHistoryRevision((current) => current + 1);
  };
  const focus = (owner: HistoryScope, id: string | null) => {
    if (mounted.current && activeScope.current === owner) setReaderFocusedAnnotationId(id);
  };
  const requirePaper = (owner: HistoryScope) => {
    const paper = aster.documents.get(owner.paperId);
    if (!paper) throw new Error('文献已移除，无法保存标注');
    return paper;
  };
  const requireAnnotation = (owner: HistoryScope, annotationId: string) => {
    const annotation = requirePaper(owner).annotations.find(item => item.id === annotationId);
    if (!annotation) throw new Error('标注已移除，请重新选择');
    return annotation;
  };
  const queueAnnotationPersistence = <T,>(owner: HistoryScope, label: string, operation: () => Promise<T>): Promise<T> => {
    const next = annotationPersistenceQueueRef.current.then(operation);
    // Recover the queue, but return the original rejection to the caller retaining its draft.
    annotationPersistenceQueueRef.current = next.catch(() => undefined);
    const reported = next.catch(error => {
      console.error('Annotation operation failed', error);
      const message = `${label}失败，未提交本次界面和历史变更，请重试原操作`;
      if (mounted.current) {
        setLibraryStatus(message);
        reportReaderSaveError(owner.paperId, message);
      }
      throw error;
    });
    // Some toolbar adapters intentionally ignore the promise; callers that await still see failure.
    void reported.catch(() => undefined);
    return reported;
  };
  const pushAnnotationHistory = (owner: HistoryScope, action: AnnotationHistoryAction) => {
    if (scopes.current.get(owner.paperId) !== owner) return;
    owner.undo = [...owner.undo.slice(-39), action];
    owner.redo = [];
  };

  const persistHistoryAction = async (action: AnnotationHistoryAction, direction: 'undo' | 'redo') => {
    if (!isTauriRuntime()) return;
    if (action.kind === 'create' || action.kind === 'delete') {
      const remove = (action.kind === 'create') === (direction === 'undo');
      if (remove) await deleteNativeAnnotation(action.annotation.id);
      else await restoreNativeAnnotation(cloneAnnotation(action.annotation));
    } else if (action.kind === 'updateComment') {
      await updateNativeAnnotationComment({ annotationId: action.annotationId, comment: direction === 'undo' ? action.previous : action.next });
    } else if (action.kind === 'updateColor') {
      await updateNativeAnnotationColor({ annotationId: action.annotationId, color: direction === 'undo' ? action.previous : action.next });
    } else {
      await updateNativeAnnotationPosition({ annotationId: action.annotationId, positionJson: clonePositionJson(direction === 'undo' ? action.previous : action.next) });
    }
  };
  const applyAnnotationHistoryAction = (owner: HistoryScope, action: AnnotationHistoryAction, direction: 'undo' | 'redo') => {
    const paper = requirePaper(owner);
    if (action.kind === 'create' || action.kind === 'delete') {
      const remove = (action.kind === 'create') === (direction === 'undo');
      if (remove) {
        paper.annotations = paper.annotations.filter(item => item.id !== action.annotation.id);
        if (mounted.current && activeScope.current === owner) setReaderFocusedAnnotationId(current => current === action.annotation.id ? null : current);
      } else {
        if (!paper.annotations.some(item => item.id === action.annotation.id)) {
          paper.annotations = [...paper.annotations, cloneAnnotation(action.annotation)].sort((a, b) => a.page - b.page || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
        }
        focus(owner, action.annotation.id);
      }
    } else {
      const annotation = requireAnnotation(owner, action.annotationId);
      if (action.kind === 'updateComment') annotation.comment = direction === 'undo' ? action.previous : action.next;
      else if (action.kind === 'updateColor') annotation.color = direction === 'undo' ? action.previous : action.next;
      else annotation.positionJson = clonePositionJson(direction === 'undo' ? action.previous : action.next);
      focus(owner, action.annotationId);
    }
  };
  const runHistoryAction = (direction: 'undo' | 'redo') => {
    const owner = scope;
    if (!owner) return Promise.resolve(false);
    return queueAnnotationPersistence(owner, direction === 'undo' ? '撤销标注' : '重做标注', async () => {
      // A queued shortcut must not operate on a document that has since lost focus/been cleared.
      if (activeScope.current !== owner || scopes.current.get(owner.paperId) !== owner) return false;
      const from = direction === 'undo' ? owner.undo : owner.redo;
      const action = from[from.length - 1];
      if (!action) return false;
      requirePaper(owner);
      if (action.kind !== 'create' && action.kind !== 'delete') requireAnnotation(owner, action.annotationId);
      await persistHistoryAction(action, direction);
      applyAnnotationHistoryAction(owner, action, direction);
      // No pop/push until the native write succeeds. Failure leaves the same action retryable.
      if (scopes.current.get(owner.paperId) === owner) {
        if (direction === 'undo') { owner.undo = owner.undo.slice(0, -1); owner.redo = [...owner.redo.slice(-39), action]; }
        else { owner.redo = owner.redo.slice(0, -1); owner.undo = [...owner.undo.slice(-39), action]; }
      }
      publish(owner);
      return true;
    }).catch(() => false); // Keyboard/toolbar callers deliberately do not await; no unhandled rejection.
  };
  const undoAnnotationAction = () => runHistoryAction('undo');
  const redoAnnotationAction = () => runHistoryAction('redo');

  const createAnnotation = (annotation: AnnotationDraft & { page: number }, fileKind = readerFileMode) => {
    const owner = scope;
    if (!owner || !selectedPaper) return Promise.resolve(undefined);
    const fileId = fileKind === 'translated' ? preferredTranslatedFileId(selectedPaper, readerTranslatedFileId) : selectedPaper.sourceFileId;
    const draft = { ...annotation, positionJson: clonePositionJson(annotation.positionJson) };
    return queueAnnotationPersistence(owner, '创建标注', async () => {
      let paper = requirePaper(owner);
      let createdId: string | undefined;
      if (isTauriRuntime()) {
        if (!fileId) throw new Error('PDF 文件标识缺失，未写入标注');
        const { page, ...payload } = draft;
        const created = await createNativeAnnotation({ paperId: owner.paperId, fileId, page, ...payload });
        createdId = created.id;
        paper = requirePaper(owner);
        if (!paper.annotations.some(item => item.id === created.id)) {
          paper.annotations = [...paper.annotations, { id: created.id, paperId: owner.paperId, fileId, ...draft, createdAt: new Date().toISOString() }]
            .sort((a, b) => a.page - b.page || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
        }
      } else {
        const created = aster.commands.execute<unknown, { id: string } | null>('document.addAnnotation', { paperId: owner.paperId, annotation: { ...draft, fileId } });
        createdId = created?.id;
      }
      const createdAnnotation = paper.annotations.find(item => item.id === createdId);
      if (!createdAnnotation) throw new Error('未确认标注创建成功');
      pushAnnotationHistory(owner, { kind: 'create', annotation: cloneAnnotation(createdAnnotation) });
      publish(owner);
      return createdId;
    });
  };

  const updateAnnotationComment = (annotationId: string, comment: string) => {
    const owner = scope;
    if (!owner) return Promise.resolve();
    return queueAnnotationPersistence(owner, '保存批注', async () => {
      const annotation = requireAnnotation(owner, annotationId);
      const previousComment = annotation.comment ?? '';
      if (previousComment === comment) return;
      if (isTauriRuntime()) await updateNativeAnnotationComment({ annotationId, comment });
      requireAnnotation(owner, annotationId).comment = comment;
      pushAnnotationHistory(owner, { kind: 'updateComment', annotationId, previous: previousComment, next: comment });
      publish(owner);
    });
  };
  const updateAnnotationColor = (annotationId: string, color: AnnotationColor) => {
    const owner = scope;
    if (!owner) return Promise.resolve();
    return queueAnnotationPersistence(owner, '保存颜色', async () => {
      const annotation = requireAnnotation(owner, annotationId);
      const previousColor = annotation.color ?? '';
      if (previousColor === color) return;
      if (isTauriRuntime()) await updateNativeAnnotationColor({ annotationId, color });
      requireAnnotation(owner, annotationId).color = color;
      pushAnnotationHistory(owner, { kind: 'updateColor', annotationId, previous: previousColor, next: color });
      publish(owner);
    });
  };
  const updateAnnotationPosition = (annotationId: string, positionJson: PositionJson) => {
    const owner = scope;
    if (!owner) return Promise.resolve();
    const nextPosition = clonePositionJson(positionJson);
    return queueAnnotationPersistence(owner, '保存位置', async () => {
      const annotation = requireAnnotation(owner, annotationId);
      const previousPosition = clonePositionJson(annotation.positionJson);
      if (JSON.stringify(previousPosition) === JSON.stringify(nextPosition)) return;
      if (isTauriRuntime()) await updateNativeAnnotationPosition({ annotationId, positionJson: clonePositionJson(nextPosition) });
      requireAnnotation(owner, annotationId).positionJson = clonePositionJson(nextPosition);
      pushAnnotationHistory(owner, { kind: 'updatePosition', annotationId, previous: previousPosition, next: clonePositionJson(nextPosition) });
      publish(owner);
    });
  };
  const deleteAnnotation = (annotationId: string) => {
    const owner = scope;
    if (!owner) return Promise.resolve();
    return queueAnnotationPersistence(owner, '删除标注', async () => {
      const paper = requirePaper(owner);
      const annotation = paper.annotations.find(item => item.id === annotationId);
      if (!annotation) return; // Repeated deletion queued after a successful delete is idempotent.
      const snapshot = cloneAnnotation(annotation);
      if (isTauriRuntime()) await deleteNativeAnnotation(annotationId);
      const currentPaper = requirePaper(owner);
      currentPaper.annotations = currentPaper.annotations.filter(item => item.id !== annotationId);
      pushAnnotationHistory(owner, { kind: 'delete', annotation: snapshot });
      if (mounted.current && activeScope.current === owner) setReaderFocusedAnnotationId(current => current === annotationId ? null : current);
      publish(owner);
    });
  };
  const clearAnnotationHistory = () => {
    if (!scope) return;
    const replacement: HistoryScope = { paperId: scope.paperId, undo: [], redo: [] };
    scopes.current.set(scope.paperId, replacement);
    if (activeScope.current === scope) activeScope.current = replacement;
    publish(replacement);
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
