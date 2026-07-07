import type { AiThreadContext, KnowledgeGraphSnapshot, KnowledgeObject, ObjectType, PaperDocument, Relation, RelationType } from './types';

export type RelationDirectionFilter = 'source' | 'target' | 'both';

export interface RelationQuery {
  direction?: RelationDirectionFilter;
  types?: RelationType[];
  excludeTypes?: RelationType[];
  objectTypes?: ObjectType[];
}

export interface RelatedObject {
  object: KnowledgeObject;
  relation: Relation;
}

export interface AnnotationTrace {
  annotation: KnowledgeObject;
  sourceFile: KnowledgeObject | null;
  sourceRelation: Relation | null;
  noteLinks: RelatedObject[];
  page: number | null;
}

export type ObjectNavigationTarget =
  | { kind: 'paper'; paperId: string }
  | { kind: 'pdf_file'; fileId: string; fileKind: 'source' | 'translated' }
  | { kind: 'note'; paperId: string; noteId: string }
  | { kind: 'annotation'; paperId: string; annotationId: string; fileId: string; page: number | null }
  | { kind: 'ai_thread'; paperId: string; threadId: string };

export interface RelationPreviewItem {
  relation: Relation;
  source: KnowledgeObject | null;
  target: KnowledgeObject | null;
  annotationTrace: AnnotationTrace | null;
}

export interface PaperRelationView {
  graph: KnowledgeGraphSnapshot;
  index: KnowledgeGraphIndex;
  files: RelatedObject[];
  notes: RelatedObject[];
  aiThreads: RelatedObject[];
  currentFileAnnotations: AnnotationTrace[];
  previewRelations: RelationPreviewItem[];
  previewMoreCount: number;
}

export interface KnowledgeGraphIndex {
  graph: KnowledgeGraphSnapshot;
  objectsById: Map<string, KnowledgeObject>;
  outgoingRelations: Map<string, Relation[]>;
  incomingRelations: Map<string, Relation[]>;
}

export function buildPaperKnowledgeGraph(paper: PaperDocument, options: { aiThreadContexts?: AiThreadContext[] } = {}): KnowledgeGraphSnapshot {
  const objects: KnowledgeObject[] = [];
  const relations: Relation[] = [];
  const paperObjectId = objectId('paper', paper.paperId);
  const aiContextByThreadId = new Map(options.aiThreadContexts?.map((context) => [context.threadId, context]) ?? []);

  objects.push({
    id: paperObjectId,
    type: 'paper',
    title: paper.title,
    summary: paper.authors || undefined,
    metadata: {
      originalId: paper.paperId,
      authors: paper.authors,
      year: paper.year || '',
      venue: paper.venue,
      doi: paper.doi,
      metadataSource: paper.metadataSource,
    },
    source: paper.metadataSource === 'builtin' ? 'builtin' : 'sqlite',
    createdAt: paper.createdAt,
  });

  if (paper.sourceFileId || paper.sourcePdf) {
    const sourceFileObjectId = objectId('pdf_file', paper.sourceFileId || `${paper.paperId}:source`);
    objects.push({
      id: sourceFileObjectId,
      type: 'pdf_file',
      title: '原文 PDF',
      metadata: {
        originalId: paper.sourceFileId,
        path: paper.sourcePdf,
        fileKind: 'source',
      },
      source: 'sqlite',
    });
    relations.push(relation(paperObjectId, sourceFileObjectId, 'attached_file', { fileKind: 'source' }));
  }

  paper.translatedPdfs.forEach((path, index) => {
    const fileId = paper.translatedFileIds[index] || `${paper.paperId}:translated:${index}`;
    const translatedObjectId = objectId('pdf_file', fileId);
    objects.push({
      id: translatedObjectId,
      type: 'pdf_file',
      title: `译文 PDF ${index + 1}`,
      metadata: {
        originalId: fileId,
        path,
        fileKind: 'translated',
      },
      source: 'sqlite',
    });
    relations.push(relation(paperObjectId, translatedObjectId, 'attached_file', { fileKind: 'translated' }));
    if (paper.sourceFileId) {
      relations.push(relation(translatedObjectId, objectId('pdf_file', paper.sourceFileId), 'derived_from', { fileKind: 'translated' }));
    }
  });

  paper.notes.forEach((note) => {
    const noteObjectId = objectId('note', note.id);
    objects.push({
      id: noteObjectId,
      type: 'note',
      title: note.title || 'Markdown 笔记',
      summary: note.content.slice(0, 140),
      metadata: {
        originalId: note.id,
        format: note.format,
        paperId: note.paperId,
      },
      source: 'sqlite',
      updatedAt: note.updatedAt,
    });
    relations.push(relation(paperObjectId, noteObjectId, 'has_note'));
  });

  paper.annotations.forEach((annotation) => {
    const annotationObjectId = objectId('annotation', annotation.id);
    objects.push({
      id: annotationObjectId,
      type: 'annotation',
      title: annotation.quote || annotation.comment || 'PDF 标注',
      summary: annotation.comment || annotation.quote,
      metadata: {
        originalId: annotation.id,
        paperId: annotation.paperId,
        fileId: annotation.fileId,
        page: annotation.page,
        annotationType: annotation.type,
        color: annotation.color,
        positionJson: annotation.positionJson,
      },
      source: 'sqlite',
      createdAt: annotation.createdAt,
    });
    const targetFileId = annotation.fileId ? objectId('pdf_file', annotation.fileId) : paperObjectId;
    relations.push(
      relation(annotationObjectId, targetFileId, 'annotates', {
        page: annotation.page,
        annotationType: annotation.type,
        color: annotation.color,
      }),
    );
    if (paper.notes[0]) {
      relations.push(
        relation(annotationObjectId, objectId('note', paper.notes[0].id), 'excerpted_from', {
          page: annotation.page,
          hasComment: Boolean(annotation.comment),
        }),
      );
    }
  });

  const aiThreadIds = Array.from(new Set([...paper.aiThreads, ...aiContextByThreadId.keys()]));
  aiThreadIds.forEach((threadId, index) => {
    const threadContext = aiContextByThreadId.get(threadId);
    const threadObjectId = objectId('ai_thread', threadId);
    objects.push({
      id: threadObjectId,
      type: 'ai_thread',
      title: `AI 对话 ${index + 1}`,
      metadata: {
        originalId: threadId,
        paperId: paper.paperId,
        providerId: threadContext?.providerId ?? '',
        prompt: threadContext?.prompt ?? '',
        contextObjectCount: threadContext?.objectIds.length ?? 0,
        contextRelationCount: threadContext?.relationIds.length ?? 0,
      },
      source: 'sqlite',
      createdAt: threadContext?.createdAt,
    });
    relations.push(relation(threadObjectId, paperObjectId, 'discusses'));
    threadContext?.objectIds
      .filter((contextObjectId) => contextObjectId !== threadObjectId && objects.some((object) => object.id === contextObjectId))
      .forEach((contextObjectId) => {
        relations.push(relation(threadObjectId, contextObjectId, 'generated_from', { providerId: threadContext.providerId, prompt: threadContext.prompt }));
      });
  });

  paper.tags.forEach((tag) => {
    relations.push(relation(paperObjectId, `tag:${tag}`, 'tagged_with', { tag }));
  });

  return {
    rootObjectId: paperObjectId,
    objects,
    relations,
  };
}

export function objectId(type: string, id: string) {
  return `${type}:${id}`;
}

export function buildPaperRelationView(paper: PaperDocument, options: { currentFileId?: string; previewLimit?: number; aiThreadContexts?: AiThreadContext[] } = {}): PaperRelationView {
  const graph = buildPaperKnowledgeGraph(paper, { aiThreadContexts: options.aiThreadContexts });
  const index = createKnowledgeGraphIndex(graph);
  const previewLimit = options.previewLimit ?? 8;
  const files = getRelatedObjects(index, graph.rootObjectId, { direction: 'source', types: ['attached_file'], objectTypes: ['pdf_file'] });
  const notes = getRelatedObjects(index, graph.rootObjectId, { direction: 'source', types: ['has_note'], objectTypes: ['note'] });
  const aiThreads = getRelatedObjects(index, graph.rootObjectId, { direction: 'target', types: ['discusses'], objectTypes: ['ai_thread'] });
  const currentFileAnnotations = options.currentFileId
    ? getRelatedObjects(index, objectId('pdf_file', options.currentFileId), { direction: 'target', types: ['annotates'], objectTypes: ['annotation'] })
        .map(({ object }) => getAnnotationTrace(index, object.id))
        .filter((trace): trace is AnnotationTrace => Boolean(trace))
    : [];
  const previewSource = getGraphRelations(index, { excludeTypes: ['tagged_with'] });
  const previewRelations = previewSource.slice(0, previewLimit).map((item) => ({
    relation: item,
    source: getObject(index, item.sourceObjectId),
    target: getObject(index, item.targetObjectId),
    annotationTrace: item.type === 'annotates' ? getAnnotationTrace(index, item.sourceObjectId) : null,
  }));
  return {
    graph,
    index,
    files,
    notes,
    aiThreads,
    currentFileAnnotations,
    previewRelations,
    previewMoreCount: Math.max(0, previewSource.length - previewRelations.length),
  };
}

export function createKnowledgeGraphIndex(graph: KnowledgeGraphSnapshot): KnowledgeGraphIndex {
  const objectsById = new Map<string, KnowledgeObject>();
  const outgoingRelations = new Map<string, Relation[]>();
  const incomingRelations = new Map<string, Relation[]>();
  for (const object of graph.objects) {
    objectsById.set(object.id, object);
  }
  for (const item of graph.relations) {
    const outgoing = outgoingRelations.get(item.sourceObjectId) ?? [];
    outgoing.push(item);
    outgoingRelations.set(item.sourceObjectId, outgoing);
    const incoming = incomingRelations.get(item.targetObjectId) ?? [];
    incoming.push(item);
    incomingRelations.set(item.targetObjectId, incoming);
  }
  return {
    graph,
    objectsById,
    outgoingRelations,
    incomingRelations,
  };
}

export function getObject(index: KnowledgeGraphIndex, objectId: string) {
  return index.objectsById.get(objectId) ?? null;
}

export function getRelations(index: KnowledgeGraphIndex, objectId: string, query: RelationQuery = {}) {
  const direction = query.direction ?? 'both';
  const relations = [
    ...(direction === 'target' ? [] : index.outgoingRelations.get(objectId) ?? []),
    ...(direction === 'source' ? [] : index.incomingRelations.get(objectId) ?? []),
  ];
  return relations.filter((item) => relationMatchesQuery(item, query));
}

export function getRelatedObjects(index: KnowledgeGraphIndex, objectId: string, query: RelationQuery = {}) {
  const related = new Map<string, RelatedObject>();
  for (const item of getRelations(index, objectId, query)) {
    const relatedObjectId = item.sourceObjectId === objectId ? item.targetObjectId : item.sourceObjectId;
    const object = index.objectsById.get(relatedObjectId);
    if (!object || (query.objectTypes && !query.objectTypes.includes(object.type))) continue;
    related.set(`${item.id}:${object.id}`, { object, relation: item });
  }
  return [...related.values()];
}

export function getGraphRelations(index: KnowledgeGraphIndex, query: Omit<RelationQuery, 'direction' | 'objectTypes'> = {}) {
  return index.graph.relations.filter((item) => relationMatchesQuery(item, query));
}

export function getAnnotationTrace(index: KnowledgeGraphIndex, annotationObjectId: string): AnnotationTrace | null {
  const annotation = getObject(index, annotationObjectId);
  if (!annotation || annotation.type !== 'annotation') return null;
  const sourceFileLink = getRelatedObjects(index, annotationObjectId, {
    direction: 'source',
    types: ['annotates'],
    objectTypes: ['pdf_file'],
  })[0];
  const noteLinks = getRelatedObjects(index, annotationObjectId, {
    direction: 'source',
    types: ['excerpted_from'],
    objectTypes: ['note'],
  });
  const page = typeof sourceFileLink?.relation.metadata.page === 'number' ? sourceFileLink.relation.metadata.page : null;
  return {
    annotation,
    sourceFile: sourceFileLink?.object ?? null,
    sourceRelation: sourceFileLink?.relation ?? null,
    noteLinks,
    page,
  };
}

export function getObjectNavigationTarget(object: KnowledgeObject): ObjectNavigationTarget | null {
  const originalId = stringMetadata(object, 'originalId');
  if (object.type === 'paper') {
    return originalId ? { kind: 'paper', paperId: originalId } : null;
  }
  if (object.type === 'pdf_file') {
    const fileKind = stringMetadata(object, 'fileKind');
    if (!originalId || (fileKind !== 'source' && fileKind !== 'translated')) return null;
    return { kind: 'pdf_file', fileId: originalId, fileKind };
  }
  if (object.type === 'note') {
    const paperId = stringMetadata(object, 'paperId');
    return paperId && originalId ? { kind: 'note', paperId, noteId: originalId } : null;
  }
  if (object.type === 'annotation') {
    const paperId = stringMetadata(object, 'paperId');
    const fileId = stringMetadata(object, 'fileId');
    const page = numberMetadata(object, 'page');
    return paperId && originalId && fileId ? { kind: 'annotation', paperId, annotationId: originalId, fileId, page } : null;
  }
  if (object.type === 'ai_thread') {
    const paperId = stringMetadata(object, 'paperId');
    return paperId && originalId ? { kind: 'ai_thread', paperId, threadId: originalId } : null;
  }
  return null;
}

function relationMatchesQuery(relation: Relation, query: RelationQuery) {
  if (query.types && !query.types.includes(relation.type)) return false;
  if (query.excludeTypes?.includes(relation.type)) return false;
  return true;
}

function stringMetadata(object: KnowledgeObject, key: string) {
  const value = object.metadata[key];
  return typeof value === 'string' ? value : '';
}

function numberMetadata(object: KnowledgeObject, key: string) {
  const value = object.metadata[key];
  return typeof value === 'number' ? value : null;
}

function relation(sourceObjectId: string, targetObjectId: string, type: Relation['type'], metadata: Relation['metadata'] = {}): Relation {
  return {
    id: `${sourceObjectId}->${type}->${targetObjectId}`,
    sourceObjectId,
    targetObjectId,
    type,
    direction: 'directed',
    metadata,
    createdBy: 'system',
  };
}
