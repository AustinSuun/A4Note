import { useEffect, useMemo, useState } from 'react';
import { readTextFilePreview } from '../../platform/projects';
import { zh } from '../../ui/zh';

export interface DiffResourceTabProps { leftPath: string; rightPath: string; name?: string }

export function DiffResourceTab({ leftPath, rightPath, name = 'Diff' }: DiffResourceTabProps) {
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setError('');
    Promise.all([readTextFilePreview(leftPath), readTextFilePreview(rightPath)]).then(([a, b]) => {
      if (cancelled) return;
      if (a.binary || b.binary) throw new Error(zh.workbench.diffBinary);
      setLeft(a.content); setRight(b.content);
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [leftPath, rightPath]);
  const rows = useMemo(() => lineDiff(left, right), [left, right]);
  return <section className="diff-resource-tab"><header className="file-tab-header"><div className="file-tab-identity"><h2>{name}</h2><p className="file-tab-path">{leftPath} &lt;-&gt; {rightPath}</p></div></header>{error ? <p className="file-tab-hint error">{error}</p> : <div className="diff-output">{rows.map((row, index) => <div key={index} className={`diff-row ${row.kind}`}><span>{row.left ?? ''}</span><span>{row.right ?? ''}</span></div>)}</div>}</section>;
}

function lineDiff(left: string, right: string) {
  const a = left.split('\n'); const b = right.split('\n'); const rows: Array<{ kind: string; left?: string; right?: string }> = [];
  const count = Math.max(a.length, b.length);
  for (let index = 0; index < count; index += 1) {
    const l = a[index]; const r = b[index];
    rows.push({ kind: l === r ? 'same' : l === undefined ? 'added' : r === undefined ? 'removed' : 'changed', left: l, right: r });
  }
  return rows;
}
