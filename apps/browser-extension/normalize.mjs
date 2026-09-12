import { enrichPage } from './enrich-page.mjs';
/** Pure, bounded parsing. Raw metadata remains available when fields conflict. */
export function httpUrl(value, base) {
  try {
    const u = new URL(value, base);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
    u.hash = '';
    return u.href;
  } catch { return null; }
}
export function normalizeDoi(value) {
  const s = String(value || '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  return /^10\.\d{4,9}\/\S+$/i.test(s) ? s.toLowerCase() : undefined;
}
export function normalizePage(page, captureId, capturedAt) {
  const sourceUrl = httpUrl(page.url);
  if (!sourceUrl) throw new Error('只支持 HTTP/HTTPS 论文页面');
  const source = new URL(sourceUrl);
  const warnings = [];
  const raw = (page.meta || []).slice(0, 2000).map(m => ({ name: String(m.name).toLowerCase(), content: String(m.content).slice(0, 24000) }));
  const entries = keys => raw.filter(m => keys.includes(m.name) && m.content.trim());
  const values = keys => [...new Set(entries(keys).map(m => m.content.trim()))];
  const evidence = [];
  function field(name, keys) {
    const rows = entries(keys);
    for (const m of rows) evidence.push({ field: name, value: m.content, source: sourceUrl, method: m.name, capturedAt });
    const choices = [...new Set(rows.map(m => m.content.trim()))];
    if (choices.length > 1 && name !== 'authors') warnings.push(`${name} 有多个候选，已保留来源`);
    // Prefer keys in the declared order, not DOM order.
    for (const key of keys) { const row = rows.find(m => m.name === key); if (row) return row.content.trim(); }
    return undefined;
  }
  const title = field('title', ['citation_title', 'dc.title', 'dcterms.title', 'og:title']) || '';
  field('authors', ['citation_author', 'dc.creator', 'dcterms.creator']);
  const authorKeys = ['citation_author', 'dc.creator', 'dcterms.creator'];
  const selectedAuthorKey = authorKeys.find(key => values([key]).length);
  // Equal names can represent distinct authors; preserve source order and multiplicity.
  const authors = entries(selectedAuthorKey ? [selectedAuthorKey] : []).map(m => ({ name: m.content.trim(), affiliations: [] }));
  const identifiers = {};
  const doiKeys = ['citation_doi', 'prism.doi', 'dc.identifier'];
  field('identifiers.doi', doiKeys);
  const doi = doiKeys.flatMap(key => values([key])).map(normalizeDoi).find(Boolean);
  if (doi) identifiers.doi = doi;
  const arxiv = /^(?:www\.)?arxiv\.org$/.test(source.hostname) ? source.pathname.match(/^\/(?:abs|pdf)\/((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)(?:\.pdf)?\/?$/i)?.[1] : undefined;
  if (arxiv) {
    identifiers.arxiv = arxiv.replace(/v\d+$/i,'');
    const version=arxiv.match(/v\d+$/i)?.[0];if(version)identifiers.arxivVersion=version;
  }
  const pmcid = /^(?:pmc\.ncbi\.nlm\.nih\.gov|www\.ncbi\.nlm\.nih\.gov)$/.test(source.hostname)
    ? source.pathname.match(/\/(?:pmc\/)?articles\/(PMC\d+)(?:\/|$)/i)?.[1]?.toUpperCase() : undefined;
  if (pmcid) identifiers.pmcid = pmcid;
  const pmid = field('identifiers.pmid', ['citation_pmid']);
  if (pmid && /^\d+$/.test(pmid)) identifiers.pmid = pmid;
  for (const key of ['arxiv', 'pmcid']) if (identifiers[key]) evidence.push({ field: `identifiers.${key}`, value: identifiers[key], source: sourceUrl, method: 'url', capturedAt });
  const metadata = {
    title, authors, identifiers,
    abstract: field('abstract', ['citation_abstract', 'dc.description', 'dcterms.abstract', 'description']),
    keywords: values(['citation_keywords', 'keywords']).flatMap(s => s.split(/[,;]/).map(x => x.trim()).filter(Boolean)),
    publication: {}, dates: {},
  };
  for (const [key, names] of Object.entries({ venue: ['citation_journal_title', 'citation_conference_title'], publisher: ['citation_publisher', 'dc.publisher'], volume: ['citation_volume'], issue: ['citation_issue'], firstPage: ['citation_firstpage'], lastPage: ['citation_lastpage'], issn: ['citation_issn'] })) {
    const value = field(`publication.${key}`, names); if (value) metadata.publication[key] = value;
  }
  for (const [key, names] of Object.entries({ online: ['citation_online_date'], published: ['citation_publication_date', 'citation_date', 'dc.date'] })) {
    const value = field(`dates.${key}`, names);
    // Keep published date precision; do not fabricate month/day or call it online.
    if (value) metadata.dates[key] = value;
  }
  const structuredPdfs=enrichPage(page,metadata,evidence,warnings,sourceUrl,capturedAt);
  if (arxiv) {
    // arXiv citation_online_date is the latest preprint revision, not journal online publication.
    if (metadata.dates.online) metadata.dates.revised = metadata.dates.online;
    if (metadata.dates.published) metadata.dates.submitted = metadata.dates.published;
    delete metadata.dates.online; delete metadata.dates.published;
    for (const e of evidence) {
      if (e.field === 'dates.online') e.field = 'dates.revised';
      if (e.field === 'dates.published') e.field = 'dates.submitted';
    }
  }
  const artifacts = [];
  const seen = new Set();
  function add(url, role, label, method) {
    const safe = httpUrl(url, sourceUrl);
    if (!safe || seen.has(safe) || artifacts.length >= 100) return;
    seen.add(safe);
    const id = `artifact-${artifacts.length + 1}`;
    artifacts.push({ id, role, url: safe, label: label || role, state: 'discovered', version: arxiv ? 'preprint' : 'unknown' });
    evidence.push({ field: `artifacts.${id}.url`, value: safe, source: sourceUrl, method, capturedAt });
  }
  for (const value of structuredPdfs) add(value,'fulltext','结构化正文 PDF','jsonld');
  for (const value of values(['citation_pdf_url'])) add(value, 'fulltext', '正文 PDF', 'citation_pdf_url');
  if (arxiv) add(`https://arxiv.org/pdf/${arxiv}`, 'fulltext', 'arXiv PDF', 'arxiv_url');
  if (/\.pdf$/i.test(source.pathname)) add(sourceUrl, 'fulltext', '当前 PDF', 'url');
  for (const link of (page.links || []).slice(0, 2000)) {
    const url = httpUrl(link.href, sourceUrl); if (!url) continue;
    const path = new URL(url).pathname;
    const label = String(link.label || '').slice(0, 300);
    // Restrict discovery to explicit publisher metadata or recognizable links.
    const supplementary = /supplement|supporting information|附录|补充材料/i.test(label) || /\/supp(?:l|lement)/i.test(path);
    if (supplementary) add(url, 'supplement', label || '补充材料候选', 'link');
    else if (pmcid && new URL(url).origin === source.origin && /\/pdf\/[^/]+\.pdf$/i.test(path)) add(url, 'fulltext', label || 'PMC PDF', 'pmc_link');
    else if (link.type === 'application/pdf' && /^(pdf|full text|全文|下载)/i.test(label)) add(url, 'fulltext', label, 'typed_link');
  }
  if (!metadata.title) warnings.push('缺少可信论文标题；未用网页标题猜测');
  if (!metadata.authors.length) warnings.push('缺少作者列表');
  if (!metadata.abstract) warnings.push('缺少摘要');
  if (!artifacts.some(a => a.role === 'fulltext')) warnings.push('尚未发现正文 PDF');
  if (page.truncated) warnings.push('页面元素超过扫描上限，采集结果可能不完整');
  warnings.push('链接仅为候选，未经下载与内容校验；附件列表不保证完整');
  return { schemaVersion: 1, captureId, origin: 'browser', capturedAt, sourceUrl, metadata, evidence, artifacts, raw: { meta: raw, jsonLd: (page.jsonLd || []).slice(0,20), domAbstract: page.domAbstract }, warnings };
}
