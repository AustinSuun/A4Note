import {useEffect, useId, useRef, useState, type PointerEvent} from 'react';
import type {Attachment, TaskClient} from '../../platform/projectTasks';
import './taskboard-dialog.css';
const purposes = {reference: '需求参考', reproduction: '复现材料', result: '完成结果'};
export const canPreviewTaskImage = (file: Attachment) => /^image\/(png|jpeg|gif|webp|bmp|avif)$/i.test(file.mime);
function useImage(file: Attachment, client: TaskClient) {
  const [state, setState] = useState({url: '', error: ''});
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true, url = '';
    setState({url: '', error: ''});
    if (canPreviewTaskImage(file)) void client.file(file.id).then(async blob => {
      if (blob.size > 10 * 1024 * 1024) throw Error('图片超过预览上限，请下载原文件');
      const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
      const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
      const raster = (bytes[0] === 137 && ascii(1, 4) === 'PNG') ||
        (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) || ascii(0, 4) === 'GIF8' ||
        (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') || ascii(0, 2) === 'BM' ||
        (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12)));
      if (!raster) throw Error('不是支持的静态图片文件；请下载检查');
      if (!active) return;
      url = URL.createObjectURL(blob);
      setState({url, error: ''});
    }).catch(e => {if (active) setState({url: '', error: e instanceof Error ? e.message : '图片加载失败'});});
    return () => {active = false; if (url) URL.revokeObjectURL(url);};
  }, [file.id, file.mime, client, attempt]);
  return {...state, retry: () => retry(v => v + 1), failed: () => setState(s => ({...s, error: '图片解码失败，可重试或下载原文件'}))};
}
async function download(file: Attachment, client: TaskClient) {
  const blob = await client.file(file.id), url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = file.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ImagePane({file, client, side}: {file: Attachment; client: TaskClient; side: string}) {
  const image = useImage(file, client);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{x: number; y: number; left: number; top: number} | null>(null);
  const [natural, setNatural] = useState({width: 0, height: 0});
  const [size, setSize] = useState({width: 0, height: 0});
  const [zoom, setZoom] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const el = viewport.current!;
    const observer = new ResizeObserver(() => setSize({width: el.clientWidth, height: el.clientHeight}));
    observer.observe(el); return () => observer.disconnect();
  }, []);
  const fit = natural.width ? Math.min(1, Math.max(1, size.width - 24) / natural.width, Math.max(1, size.height - 24) / natural.height) : 1;
  const scale = zoom ?? fit;
  const reset = () => {setZoom(null); viewport.current?.scrollTo(0, 0);};
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    e.currentTarget.scrollLeft = drag.current.left - e.clientX + drag.current.x;
    e.currentTarget.scrollTop = drag.current.top - e.clientY + drag.current.y;
  };
  return <section className="tb-image-pane" aria-label={side}>
    <header>
      <strong>{side} · {file.name}</strong>
      <small>{purposes[file.purpose]} · 附件 {file.id.slice(0, 8)}{file.retired_at ? ' · 已替代（保留原图）' : ''}</small>
      {file.caption && <p>{file.caption}</p>}
      <div className="tb-image-tools">
        <button onClick={reset}>适应窗口 / 重置</button>
        <button onClick={() => setZoom(1)}>原尺寸</button>
        <button aria-label={side + '缩小'} onClick={() => setZoom(Math.max(.02, scale / 1.25))}>−</button>
        <output aria-label={side + '缩放比例'}>{Math.round(scale * 100)}%</output>
        <button aria-label={side + '放大'} onClick={() => setZoom(Math.min(8, scale * 1.25))}>＋</button>
        <button onClick={() => void download(file, client).catch(() => setError('下载失败，请重试'))}>下载原图</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </header>
    <div className="tb-image-viewport" ref={viewport} tabIndex={0} aria-label={side + '图片，可滚动或拖动'}
      onPointerDown={e => {if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return; e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = {x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop};}}
      onPointerMove={move} onPointerUp={() => {drag.current = null;}} onPointerCancel={() => {drag.current = null;}} onLostPointerCapture={() => {drag.current = null;}}>
      {image.error ? <div role="alert">{image.error}<button onClick={image.retry}>重试图片</button></div> : image.url ?
        <div className="tb-image-canvas"><img src={image.url} alt={file.name} draggable={false}
          style={natural.width ? {width: natural.width * scale, height: natural.height * scale} : {maxWidth: '100%', maxHeight: '100%'}}
          onLoad={e => setNatural({width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight})} onError={image.failed}/></div>
        : <p role="status">图片加载中…</p>}
    </div>
  </section>;
}
export function TaskImageViewer({files, initialIds, client, onClose}: {
  files: Attachment[]; initialIds: string[]; client: TaskClient; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useId();
  const images = files.filter(canPreviewTaskImage);
  const [current, setCurrent] = useState(initialIds[0]);
  const pair = initialIds.length === 2;
  const shown = pair ? images.filter(f => initialIds.includes(f.id)).sort((a,b) => initialIds.indexOf(a.id)-initialIds.indexOf(b.id)) : images.filter(f => f.id === current);
  const index = images.findIndex(f => f.id === current);
  useEffect(() => {
    const el = dialog.current!, previous = document.activeElement as HTMLElement | null;
    el.showModal(); return () => {el.close(); if (previous?.isConnected) previous.focus({preventScroll: true});};
  }, []);
  return <dialog className="tb-image-dialog" ref={dialog} aria-labelledby={heading}
    onCancel={e => {e.preventDefault(); e.stopPropagation(); onClose();}}
    onKeyDown={e => {if (pair || (e.target as HTMLElement).closest('input,textarea,select')) return;
      if (e.key === 'ArrowLeft' && index > 0) {e.preventDefault(); setCurrent(images[index-1].id);}
      if (e.key === 'ArrowRight' && index < images.length-1) {e.preventDefault(); setCurrent(images[index+1].id);}}}>
    <header className="tb-dialog-header"><h2 id={heading}>{pair ? '图片并排对比' : '查看附件原图'}</h2>
      <div className="tb-dialog-controls">{!pair && <><button disabled={index <= 0} onClick={() => setCurrent(images[index-1].id)}>上一张</button><span>{index+1} / {images.length}</span><button disabled={index < 0 || index >= images.length-1} onClick={() => setCurrent(images[index+1].id)}>下一张</button></>}
      <button onClick={onClose} aria-label="关闭图片查看器">关闭大图</button></div></header>
    <div className={'tb-image-panes' + (pair ? ' is-pair' : '')}>
      {shown.length ? shown.map((f,i) => <ImagePane key={f.id} file={f} client={client} side={pair ? (i === 0 ? '左图' : '右图') : '当前图'}/>) : <p role="alert">图片已不可用，请关闭后重新选择。</p>}
    </div>
  </dialog>;
}
function AttachmentCard({file, client, readonly, remove, open, checked, toggle, compareFull}: {
  file: Attachment; client: TaskClient; readonly: boolean; remove: () => void; open: () => void;
  checked: boolean; toggle: () => void; compareFull: boolean;
}) {
  const image = useImage(file, client), [error, setError] = useState('');
  return <article className="tb-file">
    {canPreviewTaskImage(file) ? <button className="tb-image-thumbnail" onClick={open} aria-label={'查看大图：' + file.name}>
      {image.url && !image.error ? <img src={image.url} alt={file.name} onError={image.failed}/> : <span>{image.error || '图片加载中…'}</span>}</button> : <div className="tb-file-placeholder">附件（仅下载，不内嵌）</div>}
    <strong title={file.name}>{file.name}</strong><small>{purposes[file.purpose]} · {Math.ceil(file.size/1024)} KB{file.retired_at ? ' · 已替代' : ''}</small>
    {file.caption && <small title={file.caption}>{file.caption}</small>}
    {canPreviewTaskImage(file) && <label className="tb-compare-choice"><input type="checkbox" checked={checked} disabled={!checked && compareFull} onChange={toggle}/>选择对比：{file.name}</label>}
    {error && <p role="alert">{error}</p>}
    <div><button onClick={() => void download(file, client).catch(() => setError('下载失败，请重试'))}>下载</button>
      {!readonly && !file.retired_at && <button className="tb-danger" onClick={remove}>标记替代</button>}</div>
  </article>;
}
export function TaskAttachments({files, client, readonly, remove}: {
  files: Attachment[]; client: TaskClient; readonly: boolean; remove: (file: Attachment) => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]), [view, setView] = useState<string[] | null>(null);
  const selected = chosen.filter(id => files.some(f => f.id === id && canPreviewTaskImage(f)));
  return <section className="tb-attachment-gallery" aria-label="任务附件列表">
    <div className="tb-compare-toolbar"><span>手动选择两张图片对比（不自动推断修改前后）</span>
      <button disabled={selected.length !== 2} onClick={() => setView(selected)}>并排对比（{selected.length}/2）</button></div>
    <div className="tb-files">{files.map(file => <AttachmentCard key={file.id} file={file} client={client} readonly={readonly} remove={() => remove(file)}
      open={() => setView([file.id])} checked={selected.includes(file.id)} compareFull={selected.length === 2}
      toggle={() => setChosen(selected.includes(file.id) ? selected.filter(id => id !== file.id) : [...selected, file.id].slice(0,2))}/>)}</div>
    {view && <TaskImageViewer key={view.join(',')} files={files} initialIds={view} client={client} onClose={() => setView(null)}/>}
  </section>;
}
