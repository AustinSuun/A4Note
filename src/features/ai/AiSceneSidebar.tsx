import type { PaperDocument } from '../../core/types';

export interface AiSceneSidebarProps {
  papers: PaperDocument[];
  selectedPaperId: string | null;
  onSelectPaper: (paperId: string) => void;
}

/** Context navigator for AI conversations. The AI plugin owns this surface. */
export function AiSceneSidebar({ papers, selectedPaperId, onSelectPaper }: AiSceneSidebarProps) {
  return (
    <div className="scene-context-sidebar ai-scene-sidebar">
      <div className="scene-context-sidebar-heading">AI 会话</div>
      {papers.length === 0 ? (
        <p className="workbench-sidebar-hint">暂无可用上下文</p>
      ) : (
        <ul className="scene-context-list">
          {papers.map((paper) => (
            <li key={paper.paperId} className={paper.paperId === selectedPaperId ? 'active' : undefined}>
              <button type="button" className="scene-context-item" onClick={() => onSelectPaper(paper.paperId)} title={paper.title}>
                <span className="scene-context-item-title">{paper.title}</span>
                <span className="scene-context-item-meta">{paper.aiThreads.length ? `${paper.aiThreads.length} 个会话` : '新会话'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
