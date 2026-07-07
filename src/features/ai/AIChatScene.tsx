import type { PaperDocument } from '../../core/types';
import { zh } from '../../ui/zh';

export type AIChatMessage = { id: string; role: 'user' | 'assistant'; content: string };

export function AIChatScene({
  papers,
  selectedPaper,
  messages,
  draft,
  error,
  onSelectPaper,
  onDraftChange,
  onSend,
  onReset,
}: {
  papers: PaperDocument[];
  selectedPaper: PaperDocument;
  messages: AIChatMessage[];
  draft: string;
  error: string;
  onSelectPaper: (paperId: string) => void;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  onReset: () => void;
}) {
  return (
    <section className="scene active">
      <header className="topbar compact">
        <div>
          <h1>{zh.ai.title}</h1>
          <p className="scene-description">{zh.ai.subtitle}</p>
        </div>
        <div className="provider-pill">{zh.ai.provider}</div>
      </header>
      <div className="ai-layout">
        <aside className="soft-panel chat-list">
          {papers.map((paper) => (
            <button key={paper.paperId} className={paper.paperId === selectedPaper.paperId ? 'chat-item active' : 'chat-item'} type="button" onClick={() => onSelectPaper(paper.paperId)}>
              <strong>{paper.title}</strong>
              <span>{zh.ai.boundTopics(paper.aiThreads.length)}</span>
            </button>
          ))}
        </aside>
        <section className="chat-room">
          <div className="context-banner">
            <div>
              {zh.ai.context}: {selectedPaper.title} / {readerPdfStatusLabel(selectedPaper)}
            </div>
            <button type="button" className="subtle-banner-button rounded-button" onClick={onReset}>
              {zh.ai.newThread}
            </button>
          </div>
          <div className="messages">
            {messages.map((message) => (
              <div key={message.id} className={message.role === 'user' ? 'message user' : 'message'}>
                {message.content}
              </div>
            ))}
          </div>
          {error && <div className="chat-error">{error}</div>}
          <div className="prompt-bar">
            <input
              value={draft}
              placeholder={zh.ai.input}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
            />
            <button type="button" className="primary rounded-button" onClick={onSend} disabled={!draft.trim()}>
              {zh.ai.send}
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

function readerPdfStatusLabel(paper: PaperDocument) {
  if (paper.translatedPdfs.length) return zh.reader.translatedPdf;
  if (paper.sourcePdf) return zh.reader.sourcePdf;
  return zh.ai.noPdf;
}
