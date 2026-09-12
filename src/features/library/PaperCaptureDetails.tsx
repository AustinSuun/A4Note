import { useEffect, useRef, useState } from 'react';
import { attachPaperPdf, captureSupported, getPaperCaptureDetails, openCapturedPaperFile, type PaperCaptureDetailsData } from '../../platform/capture';

const dateLabels: Record<string, string> = { online: '在线发表', published: '发表日期', print: '印刷日期', submitted: '提交日期', revised: '修订日期', modified: '更新日期' };
export function PaperCaptureDetails({ paperId }: { paperId: string }) {
  const [loaded, setLoaded] = useState<{ id: string; data: PaperCaptureDetailsData } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const current = useRef(paperId); current.current = paperId;
  useEffect(() => {
    let active = true; setMessage('');
    if (captureSupported()) void getPaperCaptureDetails(paperId).then(data => { if (active) setLoaded({ id: paperId, data }); }).catch(e => { if (active) setMessage(String(e)); });
    return () => { active = false; };
  }, [paperId]);
  if (!captureSupported()) return null;
  const data = loaded?.id === paperId ? loaded.data : null;
  const snapshot = data?.snapshots.find(s => s.envelope.metadata);
  const m = snapshot?.envelope.metadata;
  const rows: Array<[string, string | undefined]> = [
    ['采集标题', m?.title],
    ['作者', m?.authors?.map(a => `${a.name}${a.affiliations?.length ? `（${a.affiliations.join('、')}）` : ''}${a.orcid ? ` · ORCID ${a.orcid}` : ''}`).join('；')],
    ['期刊 / 出版物', m?.publication?.venue], ['出版方', m?.publication?.publisher],
    ['卷 / 期 / 页码', [m?.publication?.volume, m?.publication?.issue, [m?.publication?.firstPage, m?.publication?.lastPage].filter(Boolean).join('–')].filter(Boolean).join(' / ')],
    ['标识', Object.entries(m?.identifiers || {}).map(([key, value]) => `${key}: ${value}`).join(' · ')],
    ['ISSN', m?.publication?.issn], ['关键词', m?.keywords?.join('、')],
    ...Object.entries(m?.dates || {}).map(([key, value]): [string, string | undefined] => [dateLabels[key] || key, value]),
  ];
  return <section className="detail-section">
    <div className="panel-title">论文信息与附件</div>
    <p className="detail-muted">PDF 与结构化论文信息分别保存。下面是采集时的信息，不会覆盖你在文献列表中的编辑。</p>
    {data && <p className="detail-muted">{data.files.some(file => file.kind === 'source_pdf') ? '已关联正文 PDF' : '正文 PDF 待补充'} · {data.snapshots.length} 份来源记录</p>}
    {m && <details open><summary>已保存的论文信息</summary><dl style={{ display: 'grid', gridTemplateColumns: 'minmax(70px,100px) minmax(0,1fr)', gap: '8px 12px', fontSize: 12, lineHeight: 1.7 }}>{rows.filter(([, value]) => value).map(([label, value]) => <div key={label} style={{ display: 'contents' }}><dt className="detail-muted">{label}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value}</dd></div>)}</dl></details>}
    {m?.abstract && <details><summary>摘要</summary><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.8 }}>{m.abstract}</p></details>}
    {data?.files.map(file => <div key={file.id} className="binding-row"><span>{({ source_pdf: '正文 PDF', translated_pdf: '译文', version_pdf: '其他版本', supplement_pdf: '补充 PDF' } as Record<string, string>)[file.kind] || file.kind}</span><button type="button" onClick={() => void openCapturedPaperFile(paperId, file.id).catch(e => { if (current.current === paperId) setMessage(String(e)); })}>打开 {file.name.slice(0, 28)}</button></div>)}
    <details><summary>来源与原始采集记录</summary><p className="detail-muted">保留原始元标签、字段来源证据、网页链接及文件候选。代码、数据集等非 PDF 内容仅保留链接，不代表已下载；缺失字段不编造。</p>{data?.snapshots.map(item => <details key={item.captureId}><summary>{item.envelope.origin === 'browser' ? '网页采集' : '本地 PDF'} · {item.envelope.sourceUrl || item.captureId}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 360, overflow: 'auto' }}>{JSON.stringify(item.envelope, null, 2)}</pre></details>)}</details>
    <button type="button" disabled={busy} onClick={async () => {
      const id = paperId; setBusy(true); setMessage('');
      try { const result = await attachPaperPdf(id); if (result) { const data = await getPaperCaptureDetails(id); if (current.current === id) { setLoaded({ id, data }); setMessage('PDF 已关联，已有正文与标注不会被替换。'); } } }
      catch (e) { if (current.current === id) setMessage(String(e)); } finally { setBusy(false); }
    }}>补充本地 PDF</button>
    <p role="status">{message}</p>
  </section>;
}
