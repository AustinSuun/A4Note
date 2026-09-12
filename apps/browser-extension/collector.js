/** Executed only following a user click. Self-contained for executeScript. */
export function collectPage() {
  const limit = 2000;
  const meta = [...document.querySelectorAll('meta[name],meta[property]')].slice(0, limit).map(el => ({
    name: (el.getAttribute('name') || el.getAttribute('property') || '').toLowerCase(),
    content: (el.getAttribute('content') || '').slice(0, 24000),
  }));
  const links = [...document.querySelectorAll('a[href],link[href]')].slice(0, limit).map(el => ({
    href: el.href, label: (el.textContent || '').trim().slice(0, 300),
    type: el.getAttribute('type') || '', rel: el.getAttribute('rel') || '',
  }));
  const jsonLd=[];let jsonBytes=0;
  for(const node of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0,20)){
    const text=node.textContent||'';if(text.length>64000||jsonBytes+text.length>256000)continue;
    jsonBytes+=text.length;try{jsonLd.push(JSON.parse(text));}catch{}
  }
  const abstractNode=document.querySelector('[itemprop="abstract"],section.abstract,#abstract,#Abs1,#abstract1');
  const domAbstract=abstractNode?.textContent?.trim().replace(/^abstract[:\s]*/i,'').slice(0,24000);
  // Only scholarly data scripts and an explicit abstract element; no executable scripts/forms/cookies.
  return { url: location.href, title: document.title, meta, links, jsonLd, domAbstract,
    truncated: document.querySelectorAll('meta[name],meta[property]').length > limit ||
      document.querySelectorAll('a[href],link[href]').length > limit };
}
