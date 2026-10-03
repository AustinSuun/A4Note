/**
 * DOM and in-page link fallbacks for publisher pages that ship no citation_* metadata.
 *
 * IEEE Xplore is an Angular SPA that serves only og:/twitter: meta tags to a real
 * browser (HTTP 202 with an empty body to anything else), so the capture must work
 * with what collectPage() already returns. Everything here stays general: no per-site
 * host allowlist, no network access, no page script execution.
 */
const AUTHOR_PATH = /\/authors?\//i;
const DOI_URL = /^https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/\S+)$/i;
const DOI_LABEL = /^10\.\d{4,9}\/\S+$/;
const PMID_URL = /^https?:\/\/(?:www\.)?pubmed\.ncbi\.nlm\.nih\.gov\/(\d{4,9})(?:\/|$)/i;
const PMCID_URL = /^https?:\/\/(?:www\.)?ncbi\.nlm\.nih\.gov\/pmc\/articles\/(PMC\d+)(?:\/|$)/i;
const ARXIV_URL = /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/((?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(v\d+)?)(?:\.pdf)?$/i;
const NOT_A_PERSON = /^(?:all authors|authors|author|show all|view all|view more|more|see all|authors info)\b/i;

function absUrl(value, base) {
  try {
    const url = new URL(String(value), base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

/**
 * og:/twitter: values are page-specific evidence only when they are self-contained
 * absolute URLs. A relative "/images/header.jpg" in og:title is a site template value
 * and must never be promoted to a paper signal.
 */
export function hasVerifiedTitleEvidence(items) {
  return (items || []).some((item) => {
    if (item?.field !== 'title') return false;
    const method = String(item.method || '');
    if (/^(?:citation_title|dc\.title|dcterms\.title|eprints\.title|jsonld)$/.test(method)) return true;
    return /^(?:og:title|twitter:title|dom_title)$/.test(method) && item.verified === true;
  });
}

/** Raw identifier candidates from in-page links; normalisation stays in normalize.mjs. */
export function linkIdentifiers(links, baseUrl) {
  const found = {};
  for (const link of (links || []).slice(0, 2000)) {
    const url = absUrl(link?.href, baseUrl);
    if (url) {
      let match;
      if (!found.doi && (match = url.match(DOI_URL))) found.doi = match[1];
      if (!found.pmid && (match = url.match(PMID_URL))) found.pmid = match[1];
      if (!found.pmcid && (match = url.match(PMCID_URL))) found.pmcid = match[1].toUpperCase();
      if (!found.arxiv && (match = url.match(ARXIV_URL))) {
        found.arxiv = match[1].replace(/v\d+$/i, '');
        if (match[2]) found.arxivVersion = match[2];
      }
    }
    // A DOI shown as link text counts only on the publisher's own origin: elsewhere it is
    // just a string a third-party page can print.
    const label = String(link?.label || '').trim();
    if (!found.doi && DOI_LABEL.test(label)) {
      const base = absUrl(baseUrl, baseUrl);
      if (url && base && new URL(url).origin === new URL(base).origin) found.doi = label;
    }
  }
  return found;
}

/**
 * Author names from same-origin author-profile links. Reads only the visible label;
 * empty tooltips, "All Authors" toggles and numeric fragments are dropped.
 */
export function authorsFromLinks(links, baseUrl, limit = 50) {
  const base = absUrl(baseUrl, baseUrl);
  const seen = new Set();
  const authors = [];
  for (const link of (links || []).slice(0, 2000)) {
    if (authors.length >= limit) break;
    const url = absUrl(link?.href, baseUrl);
    if (!url || !base || new URL(url).origin !== new URL(base).origin) continue;
    if (!AUTHOR_PATH.test(new URL(url).pathname)) continue;
    const name = String(link?.label || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (name.length < 2 || name.length > 120 || NOT_A_PERSON.test(name)) continue;
    if (!/\p{L}/u.test(name) || /\d{4,}/.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    authors.push({ name, affiliations: [] });
  }
  return authors;
}

/** Query-gated entry points: publisher download URLs whose parameters demand a session. */
// Table-of-contents links (isnumber=) are navigation, not a full-text entry point.
const GATED_QUERY = /\/stamp\/stamp\.jsp(?:[?#]|$)|\?ref=(?:download|getpdf|pdfdirect)\b|[?&]pdfdirect\b/i;
export function gatedEntryPoints(links, baseUrl) {
  const found = [];
  const seen = new Set();
  for (const link of (links || []).slice(0, 2000)) {
    const url = absUrl(link?.href, baseUrl);
    if (!url || seen.has(url)) continue;
    const flagged = link?.gated === true || GATED_QUERY.test(url);
    if (!flagged) continue;
    seen.add(url);
    found.push({
      url,
      label: String(link?.label || '').trim().slice(0, 200) || '正文入口（可能需要登录或订阅）',
      access: 'login_or_subscription',
    });
    if (found.length >= 10) break;
  }
  return found;
}

