import { useSyncExternalStore } from 'react';
import { provisionLibrarySummaries, subscribeSummaryProvision, summaryProvisionSnapshot } from '../../platform/library/provisionSummaryNotes';
import './summary-provision.css';

export function SummaryProvisionNotice() {
  const state = useSyncExternalStore(subscribeSummaryProvision, summaryProvisionSnapshot, summaryProvisionSnapshot);
  if (!state.running && !state.failed) return null;
  return (
    <div className="summary-provision-notice" role={state.running ? 'status' : 'alert'}>
      {state.running ? <span>正在补齐总结笔记：已检查 {state.scanned} 篇，新建 {state.created} 份…</span> : <>
        <span>有 {state.failed} 项总结补齐未完成。PDF 和已有笔记不受影响。</span>
        <button type="button" onClick={() => { void provisionLibrarySummaries(); }}>重试补齐</button>
        <details><summary>查看原因</summary><ul>{state.failures.map((failure, i) => (
          <li key={`${failure.paperId}:${i}`}>{failure.paperId && `${failure.paperId}：`}{failure.message}</li>
        ))}</ul>{state.failed > state.failures.length && <p>仅显示前 {state.failures.length} 项。</p>}</details>
      </>}
    </div>
  );
}
