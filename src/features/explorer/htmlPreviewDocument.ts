import { HTML_PREVIEW_CSP } from './filePreview';
import { loadNoteImage } from './noteImageLoader';
import { resolveNoteImagePath } from './noteImageSource';

export interface HtmlPreviewDocument {
  /** Goes into `<iframe sandbox="" srcdoc>`; never inserted into the app DOM. */
  srcdoc: string;
  images: { inlined: number; blocked: number };
  removedScripts: number;
}

const urlAttributes = ['src', 'href', 'poster', 'srcset', 'background', 'action', 'formaction', 'xlink:href', 'data'];

/** data: payloads, absolute http(s) and in-document fragments. Anything relative would resolve against the app. */
function allowedUrl(value: string) {
  return /^(?:data:|https?:\/\/|about:srcdoc#|#)/i.test(value.trim());
}

/**
 * Turns a user's HTML file into a self-contained, inert preview document.
 * DOMParser documents never run scripts or fetch resources, so all rewriting
 * happens before anything is rendered:
 * - scripts, embedded frames/objects, author `<base>`, meta refresh, inline
 *   event handlers and javascript: URLs are removed (sandbox="" would already
 *   block them; removing them leaves no dormant code and lets <noscript> show);
 * - forms become plain containers (nothing can be submitted);
 * - `#fragment` links keep working (`about:srcdoc#…` is a same-document jump);
 *   other links become inert and keep their target in the tooltip;
 * - relative `<img>` sources are inlined as data: URLs through the same path
 *   validation and loader as Markdown images; anything else relative is dropped;
 * - a document-level CSP and `<base href="about:blank">` are prepended, so a
 *   relative URL left in CSS cannot reach the app origin either.
 */
export async function buildHtmlPreviewDocument(html: string, htmlPath: string, loadImage: (documentPath: string, source: string) => Promise<string> = loadNoteImage): Promise<HtmlPreviewDocument> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const hadDoctype = /^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype/i.test(html);
  const removedScripts = doc.querySelectorAll('script').length;
  doc.querySelectorAll('script, base, iframe, frame, frameset, object, embed, portal, applet').forEach((node) => node.remove());
  doc.querySelectorAll('meta[http-equiv]').forEach((meta) => {
    if (/^\s*refresh\s*$/i.test(meta.getAttribute('http-equiv') ?? '')) meta.remove();
  });
  // A sandboxed submit is blocked with a console error; a plain container cannot submit at all.
  for (const form of doc.querySelectorAll('form')) {
    const container = doc.createElement('div');
    for (const attribute of [...form.attributes]) if (!['action', 'method', 'target', 'enctype'].includes(attribute.name.toLowerCase())) container.setAttribute(attribute.name, attribute.value);
    container.setAttribute('data-a4-form', '');
    container.append(...form.childNodes);
    form.replaceWith(container);
  }
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || (urlAttributes.includes(name) && /^\s*(?:javascript|vbscript):/i.test(attribute.value))) element.removeAttribute(attribute.name);
    }
  }
  for (const link of doc.querySelectorAll('a[href], area[href]')) {
    const href = (link.getAttribute('href') ?? '').trim();
    if (href.startsWith('#')) { link.setAttribute('href', `about:srcdoc${href}`); continue; }
    link.removeAttribute('href');
    link.setAttribute('data-a4-href', href);
    if (!link.getAttribute('title')) link.setAttribute('title', href);
  }
  let inlined = 0;
  let blocked = 0;
  await Promise.all([...doc.querySelectorAll('img')].map(async (image) => {
    image.removeAttribute('srcset');
    const source = (image.getAttribute('src') ?? '').trim();
    if (!source || allowedUrl(source)) return;
    if (resolveNoteImagePath(htmlPath, source)) {
      try {
        image.setAttribute('src', await loadImage(htmlPath, source));
        inlined += 1;
        return;
      } catch {
        // Falls through to "blocked": the tab reports how many images failed.
      }
    }
    image.removeAttribute('src');
    image.setAttribute('data-a4-src', source);
    blocked += 1;
  }));
  for (const element of doc.querySelectorAll('*')) {
    for (const name of urlAttributes) {
      const value = element.getAttribute(name);
      if (value === null) continue;
      if (name === 'srcset' ? value.split(',').some((candidate) => !allowedUrl(candidate.trim().split(/\s+/)[0] ?? '')) : !allowedUrl(value)) element.removeAttribute(name);
    }
  }
  const policy = doc.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', HTML_PREVIEW_CSP);
  const base = doc.createElement('base');
  base.setAttribute('href', 'about:blank');
  const style = doc.createElement('style');
  // Zero specificity: the page's own link styles win; inert links still read as links.
  style.textContent = ':where(a[data-a4-href]){color:LinkText;text-decoration:underline;cursor:default}';
  doc.head.prepend(policy, base, style);
  return { srcdoc: `${hadDoctype ? '<!DOCTYPE html>' : ''}${doc.documentElement.outerHTML}`, images: { inlined, blocked }, removedScripts };
}
