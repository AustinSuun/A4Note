import { useEffect, useState } from 'react';
import { attachPaperPdf, captureSupported, getPaperCaptureDetails, openCapturedPaperFile, type PaperCaptureDetailsData } from '../../platform/capture';
export function PaperCaptureDetails({ paperId }: { paperId: string }) {
  const [data, setData] = useState<PaperCaptureDetailsData | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true; setData(null); setMessage('');
    if (captureSupported()) void getPaperCaptureDetails(paperId).then(value => { if (active) setData(value); }).catch(e => { if (active) setMessage(String(e)); });
    return () => { active = false; };
  }, [paperId]);
  if (!captureSupported()) return null;
  const abstract = data?.snapshots.find(s => s.envelope.metadata?.abstract)?.envelope.metadata?.abstract;
  const online = data?.snapshots.find(s => s.envelope.metadata?.dates?.online)?.envelope.metadata?.dates?.online;
  return <div className="detail-section">
    <div className="panel-title">采集来源与完整元数据</div>
    <p className="detail-muted">列表字段可独立编辑；以下保留各次采集原始信息，不会覆盖你的修改。</p>
    {abstract && <details><summary>摘要</summary><p style={{ whiteSpace: 'pre-wrap' }}>{abstract}</p></details>}
    {online && <p>在线发表：{online}</p>}
    {data?.files.map(file => <div key={file.id} className="binding-row"><span>{({ source_pdf: '正文', translated_pdf: '译文', version_pdf: '其他版本', supplement_pdf: '补充材料' } as Record<string, string>)[file.kind] || file.kind}</span><button type="button" onClick={() => void openCapturedPaperFile(paperId, file.id).catch(e => setMessage(String(e)))}>打开 {file.name.slice(0, 28)}</button></div>)}
    {data?.snapshots.map(snapshot => <details key={snapshot.captureId}><summary>{snapshot.envelope.origin === 'browser' ? '网页采集' : '本地 PDF'} · {snapshot.envelope.sourceUrl || snapshot.captureId}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 360, overflow: 'auto' }}>{JSON.stringify(snapshot.envelope, null, 2)}</pre></details>)}
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true); setMessage('');
      try { const result = await attachPaperPdf(paperId); if (result) { setData(await getPaperCaptureDetails(paperId)); setMessage('PDF 已关联；已有正文与标注不会被替换。'); } }
      catch (e) { setMessage(String(e)); } finally { setBusy(false); }
    }}>补充本地 PDF</button>
    <p role="status">{message}</p>
  </div>;
}
