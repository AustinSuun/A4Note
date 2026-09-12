/** Conservative scholarly JSON-LD / abstract fallbacks; no executable page scripts. */
export function enrichPage(page,metadata,evidence,warnings,sourceUrl,capturedAt){
  const nodes=(page.jsonLd||[]).slice(0,20).flatMap(v=>Array.isArray(v)?v:v?.['@graph']||[v]).slice(0,100);
  const articles=nodes.filter(n=>[n?.['@type']].flat().includes('ScholarlyArticle'));
  const canonical=s=>{try{const u=new URL(s,sourceUrl);u.hash='';return u.href.replace(/\/$/,'');}catch{return '';}};
  const exact=articles.filter(a=>[a.url,a['@id'],a.mainEntityOfPage?.['@id']].some(v=>typeof v==='string'&&canonical(v)===canonical(sourceUrl)));
  const article=exact.length===1?exact[0]:articles.length===1?articles[0]:undefined;
  if(articles.length>1&&!article)warnings.push('多个结构化论文对象无法确定当前文献，已保留原始数据而未猜测合并');
  const set=(path,value,method)=>{
    if(typeof value==='string')value=value.trim().slice(0,24000);
    if(!value || (Array.isArray(value)&&!value.length))return;
    let target=metadata;const keys=path.split('.');for(const key of keys.slice(0,-1))target=target[key]||= {};
    const key=keys.at(-1);const selected=!target[key]||(Array.isArray(target[key])&&!target[key].length);
    if(selected)target[key]=value;
    evidence.push({field:path,value,source:sourceUrl,method,selected,capturedAt});
  };
  if(article){
    set('title',article.headline||article.name,'jsonld');set('abstract',article.abstract||article.description,'jsonld');
    set('dates.published',article.datePublished,'jsonld');set('dates.modified',article.dateModified,'jsonld');
    set('publication.publisher',typeof article.publisher==='string'?article.publisher:article.publisher?.name,'jsonld');
    set('publication.venue',article.isPartOf?.name||article.isPartOf?.isPartOf?.name,'jsonld');
    const authors=[article.author||[]].flat().slice(0,200).map(a=>({name:typeof a==='string'?a:a?.name,affiliations:[a?.affiliation||[]].flat().map(v=>typeof v==='string'?v:v?.name).filter(v=>typeof v==='string').map(v=>v.slice(0,2000))})).filter(a=>typeof a.name==='string').map(a=>({...a,name:a.name.slice(0,500)}));
    set('authors',authors,'jsonld');
    for(const author of metadata.authors){
      const match=authors.filter(a=>a.name.trim().toLowerCase()===author.name.trim().toLowerCase());
      if(match.length===1&&metadata.authors.filter(a=>a.name===author.name).length===1&&!author.affiliations?.length)author.affiliations=match[0].affiliations;
    }
    const ids=[article.identifier||[],article.sameAs||[]].flat(2);
    for(const id of ids){const value=typeof id==='string'?id?.trim():/doi/i.test(id?.propertyID||'')?id.value:undefined;
      if(typeof value!=='string')continue;const doi=value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'');
      if(/^10\.\d{4,9}\/\S+$/i.test(doi))set('identifiers.doi',doi.toLowerCase(),'jsonld');}
  }
  if(typeof page.domAbstract==='string')set('abstract',page.domAbstract,'dom_abstract');
  return [article?.encoding||[]].flat().filter(e=>e?.encodingFormat==='application/pdf'&&typeof e.contentUrl==='string').map(e=>e.contentUrl);
}
