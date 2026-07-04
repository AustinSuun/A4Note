export function renderMarkdown(markdown: string) {
  const lines = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split('\n');
  const html: string[] = [];
  let inList = false;
  for (const line of lines) {
    if (line.startsWith('- ')) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${line.slice(2)}</li>`);
      continue;
    }
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
    if (line.startsWith('## ')) {
      html.push(`<h4>${line.slice(3)}</h4>`);
    } else if (line.startsWith('# ')) {
      html.push(`<h3>${line.slice(2)}</h3>`);
    } else if (line.startsWith('> ')) {
      html.push(`<blockquote>${line.slice(2)}</blockquote>`);
    } else if (line.trim()) {
      html.push(`<p>${line}</p>`);
    } else {
      html.push('<br />');
    }
  }
  if (inList) html.push('</ul>');
  return html.join('');
}
