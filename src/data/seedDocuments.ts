import type { PaperDocument, SceneContribution } from '../core/types';

export const baseScenes: SceneContribution[] = [
  { id: 'library', label: '文献库', icon: 'L', key: '1' },
  { id: 'reader', label: '阅读', icon: 'R', key: '2' },
  { id: 'aiChat', label: 'AI 对话', icon: 'A', key: '3' },
];

export const seedDocuments: PaperDocument[] = [
  {
    paperId: 'paper-transformer',
    title: 'Attention Is All You Need',
    authors: 'Vaswani et al.',
    year: 2017,
    venue: 'NeurIPS',
    doi: '',
    folderId: 'method',
    sourceFileId: 'file-transformer-source',
    sourcePdf: '',
    translatedFileIds: [],
    translatedPdfs: [],
    tags: ['Transformer', '基础论文', '方法'],
    notes: [
      {
        id: 'note-transformer',
        paperId: 'paper-transformer',
        title: '阅读笔记',
        format: 'markdown',
        content: '# 阅读笔记\n\n核心变化是用注意力机制替代循环序列建模。\n\n- encoder-decoder\n- multi-head attention\n- positional encoding',
      },
    ],
    annotations: [
      {
        id: 'anno-transformer-1',
        paperId: 'paper-transformer',
        fileId: 'file-transformer-source',
        page: 1,
        type: 'highlight',
        quote: 'Self-attention can model sequence relationships in parallel.',
        comment: '适合作为方法演化的核心解释。',
        color: 'yellow',
        positionJson: { x: 18, y: 64, width: 46, height: 6 },
      },
    ],
    aiThreads: ['解释为什么多头注意力比单头更稳定', '总结 Transformer 对后续大模型的影响'],
    metadataSource: 'seed',
  },
  {
    paperId: 'paper-rag',
    title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
    authors: 'Lewis et al.',
    year: 2020,
    venue: 'NeurIPS',
    doi: '',
    folderId: 'writing',
    sourceFileId: 'file-rag-source',
    sourcePdf: '',
    translatedFileIds: [],
    translatedPdfs: [],
    tags: ['RAG', '检索增强', '对比'],
    notes: [
      {
        id: 'note-rag',
        paperId: 'paper-rag',
        title: '阅读笔记',
        format: 'markdown',
        content: '# 阅读笔记\n\n适合作为 AI 文献检索、知识增强问答和上下文绑定的参考文献。',
      },
    ],
    annotations: [],
    aiThreads: ['比较 RAG 和标准生成式问答', '提取可复用的系统架构'],
    metadataSource: 'seed',
  },
];
