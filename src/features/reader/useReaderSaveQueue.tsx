import { useEffect, useRef, useState } from 'react';
import './reader-reliability.css';
type Job = { id: number; label: string; error: string; pending: boolean; scope: string; operation: () => Promise<unknown>; discard?: () => void; entity?: string };
/** Failed operations remain explicit and retryable; retry cannot submit a pending job twice. */
export function useReaderSaveQueue(scope: string) {
  const jobs = useRef(new Map<number, Job>());
  const serial = useRef(0);
  const owner = useRef(scope); owner.current = scope;
  const mounted = useRef(true);
  const [rows, setRows] = useState<Job[]>([]);
  const publish = () => { if (mounted.current) setRows([...jobs.current.values()]); };
  useEffect(() => { jobs.current.clear(); setRows([]); }, [scope]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const execute = async (job: Job) => {
    if (!jobs.current.has(job.id) || job.pending || job.scope !== owner.current) return false;
    job.pending = true; job.error = ''; publish();
    try {
      await job.operation();
      jobs.current.delete(job.id);
      return true;
    } catch (error) {
      job.error = `${job.label}失败：${error instanceof Error ? error.message : String(error)}`;
      return false;
    } finally { job.pending = false; publish(); }
  };
  const run = (label: string, operation: () => Promise<unknown>, discard?: () => void, entity?: string) => {
    // A newer edit supersedes any retry for the same annotation; never replay stale geometry/color.
    if (entity) for (const job of jobs.current.values()) if (job.entity === entity) jobs.current.delete(job.id);
    const job: Job = { id: ++serial.current, label, operation, discard, error: '', pending: false, scope, entity };
    jobs.current.set(job.id, job);
    return execute(job);
  };
  const feedback = <div className="reader-save-queue" onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
    {rows.filter(job => job.scope === scope && job.error).map(job => <div className="reader-save-feedback" key={job.id} role="alert">
      <span>{job.error}</span>
      <button type="button" onClick={() => void execute(job)}>重试</button>
      <button type="button" onClick={() => { job.discard?.(); jobs.current.delete(job.id); publish(); }}>{job.discard ? '放弃未保存标注' : '关闭提示'}</button>
    </div>)}
  </div>;
  return { run, feedback };
}
