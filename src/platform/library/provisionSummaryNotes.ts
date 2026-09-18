import { invoke } from '@tauri-apps/api/core';
import { summaryNoteTemplate } from '../../core/summaryNoteTemplate';
import { acceptProvisionedSummary, type SummaryFile } from './summaries';

type Failure = { paperId: string; message: string };
type Batch = {
  scanned: number; preserved: number;
  created: Array<{ paperId: string; file: SummaryFile }>;
  failures: Failure[]; nextAfter: string | null;
};
export type SummaryProvisionState = {
  running: boolean; scanned: number; created: number; failed: number; failures: Failure[];
};
let state: SummaryProvisionState = { running: false, scanned: 0, created: 0, failed: 0, failures: [] };
const listeners = new Set<() => void>();
export const summaryProvisionSnapshot = () => state;
export function subscribeSummaryProvision(listener: () => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
function update(next: SummaryProvisionState) {
  state = next;
  for (const listener of listeners) { try { listener(); } catch (error) { console.warn(error); } }
}
let queue: Promise<void> = Promise.resolve();
/** Queue, rather than discard, a refresh arriving during an earlier scan. A newly
 * imported paper may sort before the old cursor and must be scanned next time. */
export function provisionLibrarySummaries(): Promise<void> {
  const next = queue.then(run);
  queue = next.catch(() => {});
  return next;
}
async function run(): Promise<void> {
  update({ running: true, scanned: 0, created: 0, failed: 0, failures: [] });
  try {
    // Read persisted layout; no file session or draft is modified by provisioning.
    const layout = await invoke<SummaryFile>('read_summary_layout');
    const content = summaryNoteTemplate(layout.content);
    let afterId: string | null = null;
    do {
      const batch: Batch = await invoke<Batch>('provision_summary_notes', { content, afterId });
      for (const { paperId, file } of batch.created) acceptProvisionedSummary(paperId, file);
      update({ running: true, scanned: state.scanned + batch.scanned,
        created: state.created + batch.created.length, failed: state.failed + batch.failures.length,
        failures: [...state.failures, ...batch.failures].slice(0, 20) });
      if (batch.nextAfter !== null && (batch.nextAfter === afterId || batch.scanned === 0)) throw new Error('总结补齐分页未前进，请重试。');
      afterId = batch.nextAfter;
    } while (afterId !== null);
  } catch (error) {
    // Summary failures must NOT turn a successful PDF import/list into a failed one.
    update({ ...state, failed: state.failed + 1,
      failures: [...state.failures, { paperId: '', message: String(error) }].slice(0, 20) });
  } finally { update({ ...state, running: false }); }
}
