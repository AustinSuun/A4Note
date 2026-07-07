import type { AiProviderContribution, AiProviderRunRequest, AiProviderRunResult, KnowledgeGraphSnapshot, KnowledgeObject, PaperDocument } from './types';

export async function runAiProvider({ provider, paper, graph, prompt }: AiProviderRunRequest): Promise<AiProviderRunResult> {
  const fallbackUsed = provider.kind !== 'local' || provider.status !== 'available';
  const context = buildGraphContext(graph);
  return {
    providerId: provider.id,
    content: buildLocalContextReply(paper, prompt, provider, fallbackUsed, graph, context),
    fallbackUsed,
    usedContext: {
      rootObjectId: graph.rootObjectId,
      paperId: paper.paperId,
      objectIds: graph.objects.map((object) => object.id),
      relationIds: graph.relations.map((relation) => relation.id),
      noteIds: context.notes.map((note) => String(note.metadata.originalId ?? note.id)),
      annotationIds: context.annotations.map((annotation) => String(annotation.metadata.originalId ?? annotation.id)),
      tags: paper.tags,
    },
  };
}

export function aiProviderStatusLabel(status: AiProviderContribution['status']) {
  if (status === 'available') return '可用';
  if (status === 'planned') return '规划中';
  return '已停用';
}

function buildGraphContext(graph: KnowledgeGraphSnapshot) {
  return {
    paper: graph.objects.find((object) => object.id === graph.rootObjectId) ?? null,
    files: graph.objects.filter((object) => object.type === 'pdf_file'),
    notes: graph.objects.filter((object) => object.type === 'note'),
    annotations: graph.objects.filter((object) => object.type === 'annotation'),
    aiThreads: graph.objects.filter((object) => object.type === 'ai_thread'),
  };
}

function buildLocalContextReply(
  paper: PaperDocument,
  prompt: string,
  provider: AiProviderContribution,
  fallbackUsed: boolean,
  graph: KnowledgeGraphSnapshot,
  context: ReturnType<typeof buildGraphContext>,
) {
  const tags = paper.tags.length ? paper.tags.join(' / ') : '未分类';
  const note = summarizeKnowledgeObjects(context.notes) || '当前还没有阅读笔记。';
  const fallbackNotice = fallbackUsed ? `\n说明：${provider.name} 尚未接入真实运行，本次暂时使用本地上下文助手生成回复。` : '';
  return `Provider：${provider.name}（${aiProviderStatusLabel(provider.status)}）${fallbackNotice}
已绑定文献：${context.paper?.title ?? paper.title}
标签：${tags}
知识对象：${graph.objects.length} 个，关系：${graph.relations.length} 条
PDF：${context.files.length} 个，笔记：${context.notes.length} 条，标注：${context.annotations.length} 条

你的问题：${prompt}

当前会先基于知识对象、关系链、标签、笔记和标注组织上下文，并把对话保存到本地资料库。参考笔记：${note}`;
}

function summarizeKnowledgeObjects(objects: KnowledgeObject[]) {
  return objects
    .map((object) => object.summary || object.title)
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
}
