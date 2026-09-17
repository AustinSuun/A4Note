/** App-owned suffix in the standard image title; URL/alt/caption stay intact. */
export type ImageLayout = { width: number; align: 'left' | 'center' | 'right' };
const layoutSuffix = /\s*\[a4note-image:(\d+):(left|center|right)\]$/;
export function readImageTitle(title = ''): { caption: string; layout?: ImageLayout } {
  const match = title.match(layoutSuffix);
  if (!match || Number(match[1]) < 10 || Number(match[1]) > 100) return { caption: title };
  return { caption: title.slice(0, match.index).trimEnd(), layout: { width: Number(match[1]), align: match[2] as ImageLayout['align'] } };
}
export function imageLayoutTitle(title: string, layout: ImageLayout | null) {
  const caption = readImageTitle(title).caption;
  if (!layout) return caption;
  const width = Math.max(10, Math.min(100, Math.round(layout.width)));
  return `${caption}${caption ? ' ' : ''}[a4note-image:${width}:${layout.align}]`;
}
const markdownImage = /^(!\[[^\]]*\]\((?:<[^>\n]+>|(?:\\.|[^\s)])+))(?:\s+(["'])((?:\\.|[^\\])*?)\2)?\)$/;
const htmlTitle = /\btitle\s*=\s*(["'])(.*?)\1/i;
export function imageSourceTitle(source: string): string {
  if (/^<img\s/i.test(source)) return (source.match(htmlTitle)?.[2] ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return (source.match(markdownImage)?.[3] ?? '').replace(/\\([\\"'])/g, '$1');
}
/** Changes only this image's title, keeping destination and other attributes untouched. */
export function withImageLayout(source: string, layout: ImageLayout | null): string | null {
  const title = imageLayoutTitle(imageSourceTitle(source), layout);
  if (/^<img\s/i.test(source)) {
    const escaped = title.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    if (htmlTitle.test(source)) return source.replace(htmlTitle, () => `title="${escaped}"`);
    return source.replace(/\s*\/?>$/, ending => ` title="${escaped}"${ending}`);
  }
  const match = source.match(markdownImage);
  if (!match) return null;
  return `${match[1]}${title ? ` "${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : ''})`;
}
