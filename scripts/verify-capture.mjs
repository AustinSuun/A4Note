import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizePage, normalizeDoi, httpUrl } from '../apps/browser-extension/normalize.mjs';
import { authorsFromLinks, gatedEntryPoints, hasVerifiedTitleEvidence, linkIdentifiers } from '../apps/browser-extension/dom-fallbacks.mjs';
const time = '2026-09-11T14:00:00Z';
const row = (name, content) => ({ name, content });
const parse = page => normalizePage({ meta: [], links: [], ...page }, 'fixture-id', time);
assert.equal(httpUrl('javascript:alert(1)', 'https://example.org'), null);
assert.equal(httpUrl('https://user:pass@example.org/file'), null);
assert.equal(httpUrl('/paper.pdf#page=1', 'https://example.org'), 'https://example.org/paper.pdf');
assert.equal(normalizeDoi('https://doi.org/10.1000/ABC'), '10.1000/abc');
assert.equal(normalizeDoi('not-doi'), undefined);
const arxiv = parse({ url: 'https://arxiv.org/abs/2401.12345v2', meta: [row('citation_title', 'Paper'), row('citation_author', 'A'), row('citation_author', 'B'), row('citation_pdf_url', 'https://arxiv.org/pdf/2401.12345v2')] });
assert.equal(arxiv.metadata.identifiers.arxiv, '2401.12345');
assert.equal(arxiv.artifacts.length, 1);
assert.equal(arxiv.artifacts[0].version, 'preprint');
assert.deepEqual(arxiv.metadata.authors.map(a => a.name), ['A', 'B']);
const legacy = parse({ url: 'https://arxiv.org/abs/hep-th/9901001v1' });
assert.equal(legacy.metadata.identifiers.arxiv, 'hep-th/9901001');
const fake = parse({ url: 'https://arxiv.org.evil.example/abs/2401.12345' });
assert.equal(fake.metadata.identifiers.arxiv, undefined);
const pmc = parse({ url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC123456/', links: [{ href: '/articles/PMC123456/pdf/main.pdf', label: 'PDF' }, { href: '/articles/PMC123456/bin/supplement.zip', label: 'Supplementary data' }] });
assert.equal(pmc.metadata.identifiers.pmcid, 'PMC123456');
assert.deepEqual(pmc.artifacts.map(a => a.role), ['fulltext', 'supplement']);
const generic = parse({ url: 'https://journal.example/paper', meta: [row('og:title', 'Site headline'), row('citation_title', 'Real title'), row('citation_online_date', '2025-01-02'), row('citation_publication_date', '2026'), row('citation_pdf_url', '/full.pdf'), row('citation_pdf_url', 'javascript:alert(1)'), row('citation_author', '<script>unsafe</script>')] });
assert.equal(generic.metadata.title, 'Real title');
assert.equal(generic.metadata.dates.online, '2025-01-02');
assert.equal(generic.metadata.dates.published, '2026');
assert.equal(generic.artifacts.length, 1);
assert.ok(generic.warnings.some(w => w.includes('多个候选')));
assert.equal(generic.raw.meta.length, 7);
const empty = parse({ url: 'https://example.org', title: 'Not a paper', truncated: true });
assert.equal(empty.metadata.title, '');
assert.ok(empty.warnings.some(w => w.includes('扫描上限')));
assert.equal(empty.metadata.dates.online, undefined);
assert.throws(() => parse({ url: 'file:///C:/private.pdf' }));
const manifest = JSON.parse(await readFile('apps/browser-extension/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.host_permissions, undefined);
assert.ok(manifest.permissions.includes('nativeMessaging'));
assert.ok(manifest.key);
assert.ok(!manifest.permissions.includes('cookies'));
assert.ok(!manifest.permissions.includes('debugger'));
const popup = await readFile('apps/browser-extension/popup.js', 'utf8');
assert.ok(!popup.includes('innerHTML'));

// Native schema requires canonical UUIDs; browser uses crypto.randomUUID().
const duplicateAuthors = parse({ url: 'https://example.org/paper', meta: [row('citation_author', 'Wang Wei'), row('citation_author', 'Wang Wei')] });
assert.equal(duplicateAuthors.metadata.authors.length, 2);
const doiFallback = parse({ url: 'https://example.org/paper', meta: [row('dc.identifier', 'PMID:123'), row('prism.doi', '10.1000/valid')] });
assert.equal(doiFallback.metadata.identifiers.doi, '10.1000/valid');

console.log('Capture parser and least-privilege contract checks passed (synthetic fixtures; not live-site/browser E2E).');

// IEEE Xplore shape (task 5fd94c28): an Angular SPA with og: meta only, DOI and author
// links, and a stamp.jsp entry point. The title must survive, the DOI must come from the
// in-page link, authors from author-profile links, and the gated PDF must be reported
// honestly instead of being fetched.
const ieee = parse({ url: 'https://ieeexplore.ieee.org/document/9903612',
  meta: [row('og:title', 'MD3D: Mixture-Density-Based 3D Object Detection in Point Clouds'),
    row('og:description', 'The design factors of anchor boxes'), row('twitter:title', 'MD3D share title')],
  links: [
    { href: 'https://doi.org/10.1109/ACCESS.2022.3210108', label: '10.1109/ACCESS.2022.3210108' },
    { href: 'https://ieeexplore.ieee.org/author/37085648258', label: 'Jaeseok Choi' },
    { href: '/author/37089195857', label: 'Yeji Song' },
    { href: 'javascript:void()', label: 'All Authors' },
    { href: 'https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=9903612', label: 'Download PDF', gated: true },
    { href: 'https://twitter.com/IEEEXplore?ref_src=twsrc%5Egoogle', label: 'IEEE Xplore' },
  ] });
assert.equal(ieee.metadata.title, 'MD3D: Mixture-Density-Based 3D Object Detection in Point Clouds');
assert.equal(ieee.metadata.identifiers.doi, '10.1109/access.2022.3210108');
assert.deepEqual(ieee.metadata.authors.map(a => a.name), ['Jaeseok Choi', 'Yeji Song']);
assert.equal(ieee.artifacts.length, 1);
assert.equal(ieee.artifacts[0].state, 'discovered');
assert.equal(ieee.artifacts[0].gated, true);
assert.equal(ieee.artifacts[0].access, 'login_or_subscription');
assert.ok(ieee.warnings.some(w => w.includes('登录或订阅')));
assert.ok(!ieee.warnings.includes('尚未发现正文 PDF'));
assert.equal(ieee.evidence.find(e => e.field === 'title').method, 'og:title');

// A site-template og:title (relative path) must never count as a paper signal, and the
// signal helper must not accept evidence that is unrelated to the title.
const spoiled = parse({ url: 'https://example.org/paper/1', meta: [row('og:title', '/images/header.jpg')] });
assert.equal(hasVerifiedTitleEvidence(spoiled.evidence), false);
assert.equal(spoiled.metadata.title, '/images/header.jpg');
const unrelated = parse({ url: 'https://example.org/paper/1', meta: [row('og:url', 'https://example.org/paper/1')] });
assert.equal(hasVerifiedTitleEvidence(unrelated.evidence), false);

// Canonical identifier links on an otherwise meta-thin page.
const linked = parse({ url: 'https://journal.example/a', meta: [row('og:title', 'A study')], links: [
  { href: 'https://pubmed.ncbi.nlm.nih.gov/39012345/', label: 'PubMed' },
  { href: 'https://arxiv.org/abs/2401.12345v2', label: 'arXiv' },
  { href: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/', label: 'PMC' }] });
assert.equal(linked.metadata.identifiers.pmid, '39012345');
assert.equal(linked.metadata.identifiers.arxiv, '2401.12345');
assert.equal(linked.metadata.identifiers.arxivVersion, 'v2');
assert.equal(linked.metadata.identifiers.pmcid, 'PMC1234567');
assert.ok(linked.evidence.some(e => e.method === 'pubmed_link'));

// citation_* still wins; fallbacks only fill gaps.
const preferMeta = parse({ url: 'https://journal.example/b',
  meta: [row('citation_title', 'Real title'), row('og:title', 'Share title')],
  links: [{ href: 'https://doi.org/10.1000/meta', label: '10.1000/meta' }] });
assert.equal(preferMeta.metadata.title, 'Real title');
assert.equal(preferMeta.metadata.identifiers.doi, '10.1000/meta');

// Author-link hygiene: no cross-origin profiles, no toggles, no numeric fragments.
assert.deepEqual(authorsFromLinks([
  { href: 'https://twitter.com/IEEEXplore?ref_src=twsrc%5Egoogle', label: 'IEEE Xplore' },
  { href: '/author/1', label: 'All Authors' },
  { href: '/author/2', label: '37085648' },
  { href: '/author/3', label: 'Ada Lovelace' },
], 'https://ieeexplore.ieee.org/document/9903612'), [{ name: 'Ada Lovelace', affiliations: [] }]);
assert.deepEqual(linkIdentifiers([{ href: 'https://evil.example/10.1234/fake', label: '10.9999/label' }], 'https://journal.example/a'), {});
// …but a same-origin link whose visible text is the DOI still counts (publisher redirects).
assert.deepEqual(linkIdentifiers([{ href: '/document/9903612', label: '10.1109/ACCESS.2022.3210108' }], 'https://ieeexplore.ieee.org/document/9903612'),
  { doi: '10.1109/ACCESS.2022.3210108' });
assert.deepEqual(gatedEntryPoints([{ href: '/stamp/stamp.jsp?tp=&arnumber=1', label: 'PDF' }], 'https://ieeexplore.ieee.org/document/1'),
  [{ url: 'https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=1', label: 'PDF', access: 'login_or_subscription' }]);
// Issue/volume navigation must not be mistaken for a full-text entry point.
assert.deepEqual(gatedEntryPoints([{ href: '/xpl/tocresult.jsp?isnumber=9668973&punumber=6287639', label: 'Volume: 10' }], 'https://ieeexplore.ieee.org/document/1'), []);

const revisedArxiv = parse({ url: 'https://arxiv.org/abs/1706.03762', meta: [row('citation_date','2017/06/12'),row('citation_online_date','2023/08/02')] });
assert.equal(revisedArxiv.metadata.dates.online, undefined);
assert.equal(revisedArxiv.metadata.dates.revised, '2023/08/02');
assert.equal(revisedArxiv.metadata.dates.submitted, '2017/06/12');

const structured=parse({url:'https://journal.example/paper',jsonLd:[{'@type':'ScholarlyArticle',headline:'Structured title',author:[{name:'Ada',affiliation:{name:'Lab'}}],abstract:'Full abstract',datePublished:'2024-03',identifier:{propertyID:'doi',value:'10.1234/test'}}]});
assert.equal(structured.metadata.title,'Structured title');assert.equal(structured.metadata.authors[0].affiliations[0],'Lab');assert.equal(structured.metadata.identifiers.doi,'10.1234/test');assert.equal(structured.metadata.dates.online,undefined);
const stronger=parse({url:'https://journal.example/paper',meta:[row('citation_title','Page title')],jsonLd:[{'@type':'ScholarlyArticle',headline:'Structured title'}],domAbstract:'DOM abstract'});
assert.equal(stronger.metadata.title,'Page title');assert.equal(stronger.metadata.abstract,'DOM abstract');

assert.equal(arxiv.metadata.identifiers.arxivVersion, "v2");

// OpenReview hosts the note but serves the PDF from the publisher: the page's own
// "Download PDF" control must win over the same-site citation_pdf_url proxy.
const cvf='https://openaccess.thecvf.com/content/CVPR2026/papers/Geng_Improved_Mean_Flows_CVPR_2026_paper.pdf';
const openreview=parse({url:'https://openreview.net/forum?id=aVC3VMPUmR',meta:[row('citation_title','Improved Mean Flows: On the Challenges of Fastforward Generative Models'),row('citation_pdf_url','https://openreview.net/pdf?id=aVC3VMPUmR')],links:[{href:cvf,label:'',title:'Download PDF',primaryPdf:true}]});
assert.equal(openreview.artifacts.length,1);
assert.equal(openreview.artifacts[0].url,cvf);
assert.equal(openreview.artifacts[0].role,'fulltext');
assert.equal(openreview.artifacts[0].label,'Download PDF');
assert.ok(openreview.warnings.some(w=>w.includes('页面下载链接')));
assert.ok(openreview.evidence.some(e=>e.method==='primary_pdf_link'&&e.value===cvf));
// An unambiguous control that matches metadata changes nothing.
const hosted=parse({url:'https://openreview.net/forum?id=WPcqBri0DF',meta:[row('citation_title','Discrete MeanFlow'),row('citation_pdf_url','https://openreview.net/pdf?id=WPcqBri0DF')],links:[{href:'https://openreview.net/pdf?id=WPcqBri0DF',label:'',title:'Download PDF',primaryPdf:true}]});
assert.equal(hosted.artifacts.length,1);
assert.equal(hosted.artifacts[0].url,'https://openreview.net/pdf?id=WPcqBri0DF');
assert.ok(!hosted.warnings.some(w=>w.includes('页面下载链接')));
// Several page controls are ambiguous: keep metadata, never guess.
const ambiguous=parse({url:'https://openreview.net/forum?id=multi',meta:[row('citation_title','Multi'),row('citation_pdf_url','https://openreview.net/pdf?id=multi')],links:[{href:cvf,label:'',title:'Download PDF',primaryPdf:true},{href:'https://example.org/other.pdf',label:'',title:'Download PDF',primaryPdf:true}]});
assert.equal(ambiguous.artifacts.length,1);
assert.equal(ambiguous.artifacts[0].url,'https://openreview.net/pdf?id=multi');
// A page control alone still resolves without metadata.
const controlOnly=parse({url:'https://example.org/paper',meta:[row('citation_title','Control only')],links:[{href:'/paper.pdf',label:'Download PDF',primaryPdf:true}]});
assert.equal(controlOnly.artifacts.length,1);
assert.equal(controlOnly.artifacts[0].url,'https://example.org/paper.pdf');
assert.equal(controlOnly.artifacts[0].label,'Download PDF');

