import type { Note, PaperSummary } from '../models/note';

export const fixturePapers: PaperSummary[] = [
  {
    id: 'paper-transformer',
    title: 'Attention Is All You Need',
    authors: 'Vaswani et al.',
    year: 2017,
    venue: 'NeurIPS',
  },
  {
    id: 'paper-rag',
    title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
    authors: 'Lewis et al.',
    year: 2020,
    venue: 'NeurIPS',
  },
];

export const fixtureNotes: Note[] = [
  {
    id: 'note-transformer',
    paperId: 'paper-transformer',
    title: '阅读笔记：Attention Is All You Need',
    content: '# 阅读笔记\n\n核心变化是用自注意力机制替代循环序列建模。\n\n- encoder-decoder\n- multi-head attention\n- positional encoding',
    format: 'markdown',
    createdAt: '2026-08-12T09:30:00.000Z',
    updatedAt: '2026-08-19T14:20:00.000Z',
    serverVersion: 4,
    syncState: 'synced',
  },
  {
    id: 'note-rag',
    paperId: 'paper-rag',
    title: 'RAG 方法要点',
    content: '# RAG 方法要点\n\n检索增强生成适合把外部知识接入生成式问答。需要关注检索质量、上下文长度和引用可追溯性。',
    format: 'markdown',
    createdAt: '2026-08-15T08:15:00.000Z',
    updatedAt: '2026-08-18T11:05:00.000Z',
    serverVersion: 2,
    syncState: 'pending',
  },
];

