import './compact-view.js';
import { browserAssist } from './browser-assist.mjs';
import { setupBridge } from './bridge-ui.js';
import { collectPage } from './collector.js';
import { normalizePage } from './normalize.mjs';
import { hasVerifiedTitleEvidence } from './dom-fallbacks.mjs';
const get = id => document.getElementById(id);
let envelope;
const status = message => { get('status').textContent = message; };
const bridge = setupBridge(() => envelope, status);
async function scan() {
  if (!bridge.beginScan()) return;
  status('正在识别当前论文…');
  get('result').hidden = true;
  envelope = undefined;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('没有可读取的标签页');
    let result;
    try {
      [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPage });
    } catch {
      throw new Error('此页面不允许读取（浏览器系统页或权限未授予）；请在普通论文详情页重试');
    }
    if (!result?.result) throw new Error('页面不可读取；浏览器内置PDF查看器可返回论文详情页重试');
    const detected = normalizePage(result.result, crypto.randomUUID(), new Date().toISOString());
    const paperSignal = ['doi','arxiv','pmcid','pmid'].some(key => detected.metadata.identifiers[key])
      || hasVerifiedTitleEvidence(detected.evidence);
    if (!detected.metadata.title?.trim() || !paperSignal) throw new Error(identifyHint(detected));
    envelope = detected;
    get('title').textContent = envelope.metadata.title || '未识别到论文标题';
    get('title').title = envelope.metadata.title;
    renderMetadata(envelope);
    renderPaperLinks(envelope);
    get('authors').textContent = envelope.metadata.authors.map(a => a.name).join(' · ');
    get('ids').textContent = Object.entries(envelope.metadata.identifiers).map(([k, v]) => `${k}: ${v}`).join(' / ');
    get('warnings').replaceChildren(...envelope.warnings.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
    get('files').replaceChildren(...envelope.artifacts.map((artifact, index) => {
      const row = document.createElement('div'); row.className = 'file';
      const label = document.createElement('p'); label.textContent = `${artifact.label} · ${new URL(artifact.url).hostname}`;
      const gated = artifact.gated === true;
      const button = document.createElement('button'); button.textContent = gated ? '在浏览器中打开' : '仅保存文件到电脑';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          if (gated) {
            // Publisher endpoints behind a session are opened for the user; the extension
            // never logs in, never bypasses a paywall and never claims a download.
            await chrome.tabs.create({ url: artifact.url, active: true });
            status('已在浏览器打开正文入口；该链接可能需要登录或订阅，插件不会代替你登录或绕过权限。');
            return;
          }
          // Browser manages credentials and lifetime. Accepted != completed or validated.
          await chrome.downloads.download({ url: artifact.url, saveAs: true, conflictAction: 'uniquify' });
          status('已交给浏览器下载。请在下载列表核对文件；尚未验证文件内容或导入 A4 Note。');
        } catch (error) { status(`下载未启动：${error.message}`); }
        finally { button.disabled = false; }
      });
      row.append(label, button);
      if (!gated && (artifact.role==='fulltext'||artifact.role==='supplement'&&/\.pdf(?:$|[?#])/i.test(artifact.url))) {
        const assist=document.createElement('button');assist.textContent='浏览器辅助获取 PDF';assist.dataset.assist='true';assist.disabled=true;
        assist.addEventListener('click',async()=>{assist.disabled=true;try{await bridge.assist(index,browserAssist);}catch(e){status(`辅助入库：${e.message}`);}});
        row.append(assist);
      }
      return row;
    }));
    get('result').hidden = false;
    const openFulltext = envelope.artifacts.some(a=>a.role==='fulltext'&&!a.gated);
    status(openFulltext?'已识别，选择文件夹即可保存。'
      : envelope.artifacts.some(a=>a.gated)?'已识别论文；正文 PDF 需要登录或订阅，请在浏览器中打开后自行下载。'
      : '未找到正文链接；不会创建缺PDF条目，请检查论文详情或下载帮助。');
  } catch (error) { status(`识别失败：${error.message}`); }
  finally { await bridge.scanned(); }
}
/** Names the failed step instead of a catch-all: users need the next action, not silence. */
function identifyHint(capture) {
  if (!capture.metadata.title?.trim()) return '未在本页找到论文标题（页面缺少 citation_*/og: 标题元数据）；请打开论文详情页后重试';
  return '页面只提供了站点级分享标题，且没有 DOI/arXiv/PubMed 等标识；请打开论文详情页后重试';
}
get('scan').addEventListener('click', () => void scan());
void scan();
get('export').addEventListener('click', async () => {
  if (!envelope) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' }));
  get('export').disabled = true;
  try {
    await chrome.downloads.download({ url, filename: `A4Note/capture-${envelope.captureId}.json`, saveAs: true, conflictAction: 'uniquify' });
    status('采集记录已交给浏览器保存；不代表正文已下载或文献已入库。');
  } catch (error) { status(`导出失败：${error.message}`); }
  finally { get('export').disabled = false; setTimeout(() => URL.revokeObjectURL(url), 60000); }
});

function renderMetadata(capture) {
  const m=capture.metadata, ids=m.identifiers;
  const entries=[['标题',m.title],['作者',m.authors.map(a=>a.name).join('；')],['期刊',m.publication.venue],['日期',Object.entries(m.dates).map(([key,value])=>`${({published:'发表',online:'在线',print:'印刷',submitted:'提交',revised:'修订',modified:'更新'})[key]||key} ${value}`).join(' · ')],['标识',Object.entries(ids).map(([k,v])=>`${k}: ${v}`).join(' · ')],['关键词',m.keywords.join('、')],['摘要',m.abstract]];
  const dl=document.createElement('dl');let count=0;
  for(const [label,value] of entries){if(!value)continue;count++;const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;if(label==='摘要')dd.className='abstract';dl.append(dt,dd);}
  get('metadata-details').replaceChildren(dl);get('metadata-summary').textContent=`${count} 项已识别`;
  get('pdf-evidence').textContent=capture.artifacts.some(a=>a.role==='fulltext'&&!a.gated)?'＋ 正文 PDF 链接'
    :capture.artifacts.some(a=>a.gated)?'正文 PDF 需要登录或订阅':'正文 PDF 待补充';
}

function renderPaperLinks(capture) {
  const items=[{url:capture.sourceUrl,label:'原文页面'},...capture.artifacts.filter(a=>a.role==='fulltext').map(a=>({...a,label:a.label||'正文 PDF'}))];
  get('paper-links').replaceChildren(...items.map(item=>{
    const row=document.createElement('div');row.className='paper-link-row';
    const link=document.createElement('a');link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=item.label;link.title=item.url;
    const state=document.createElement('span');state.className='paper-link-state';
    state.textContent=!item.id?'当前识别来源':item.gated?'需要登录或订阅':'已发现，未下载';
    if(item.id)row.dataset.artifactId=item.id;
    row.append(link,state);return row;
  }));
}
