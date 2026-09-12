// GitHub draft download URLs may use an untagged-* placeholder until publication.
export function verifyDraftAssets(assets,expected){
  for(const file of expected){
    const matches=assets.filter(a=>a.name===file.name);
    if(matches.length!==1 || matches[0].state!=='uploaded' || matches[0].size!==file.size)throw new Error(`Incomplete uploaded asset: ${file.name}`);
    if(matches[0].digest && matches[0].digest!==`sha256:${file.sha256}`)throw new Error(`Uploaded asset digest mismatch: ${file.name}`);
  }
}
export function verifyPublishedUrls(assets,urls){
  if(urls.some(url=>!assets.some(asset=>asset.url===url&&asset.state==='uploaded')))throw new Error('Published asset URLs differ from updater manifest; inspect release without replacing signed binaries.');
}
