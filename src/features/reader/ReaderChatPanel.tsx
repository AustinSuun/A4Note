import type { PaperDocument } from '../../core/types';
import { zh } from '../../ui/zh';

export function ReaderChatPanel({ paper }: { paper: PaperDocument }) {
  return (
    <>
      <div className="panel-title">{zh.reader.aiAssist}</div>
      <div className="mini-message">{zh.reader.aiContextBound(paper.annotations.length)}</div>
      <div className="mini-message">{zh.ai.providerHint}</div>
    </>
  );
}
