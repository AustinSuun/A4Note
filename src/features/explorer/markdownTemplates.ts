export type MarkdownTemplate = { id: string; label: string; group: string; source: string; block: boolean };
export const markdownTemplates: MarkdownTemplate[] = [
  ...Array.from({ length: 6 }, (_, index) => ({ id: `h${index + 1}`, label: `${index + 1} 级标题`, group: '文本与标题', source: '#'.repeat(index + 1) + ' 标题', block: true })),
  ...[
    ['bold', '粗体', '**文字**'], ['italic', '斜体', '*文字*'], ['strike', '删除线', '~~文字~~'], ['highlight', '高亮', '==文字=='], ['inline-code', '行内代码', '`代码`'],
    ['link', '外部链接', '[链接文字](https://example.com)'], ['wiki', '笔记双链', '[[笔记名称]]'], ['inline-math', '行内公式', '$E = mc^2$'],
    ['sup', '上标', '<sup>2</sup>'], ['sub', '下标', '<sub>2</sub>'], ['kbd', '键盘按键', '<kbd>Ctrl</kbd>'],
    ['underline', '下划线', '<u>文字</u>'], ['small', '小字', '<small>文字</small>'], ['abbr', '缩写', '<abbr title="完整名称">缩写</abbr>'], ['mark', 'HTML 高亮', '<mark>文字</mark>'], ['html-strike', 'HTML 删除线', '<s>文字</s>'],
    ['line-break', '换行', '<br>'],
  ].map(([id, label, source]) => ({ id, label, source, group: '文本与标题', block: false })),
  ...[
    ['paragraph', '正文段落', '正文'],
    ['bullet', '无序列表', '- 列表项一\n- 列表项二'], ['numbered', '有序列表', '1. 列表项一\n2. 列表项二'], ['nested', '嵌套列表', '- 父级项目\n  - 子级项目'],
    ['tasks', '任务清单', '- [ ] 待完成任务\n- [x] 已完成任务'], ['quote', '引用', '> 引用内容'], ['rule', '分隔线', '---'],
    ['table', '表格（3列）', '|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |'],
    ['code', '代码块', '```text\n在这里输入代码\n```'], ['math', '公式块', '$$\nE = mc^2\n$$'],
    ['image', '图片地址', '![图片说明](https://example.com/image.png "图片标题")'],
    ['footnote', '脚注与引用', '带脚注的文字[^note]\n\n[^note]: 脚注内容'],
  ].map(([id, label, source]) => ({ id, label, source, group: '列表与内容块', block: true })),
  ...['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION', 'SUCCESS', 'QUESTION', 'QUOTE', 'EXAMPLE', 'ABSTRACT', 'TODO', 'DANGER', 'ERROR', 'HELP', 'HINT', 'INFO'].map((type) => ({ id: `callout-${type}`, label: `标注 · ${type}`, group: '标注块', source: `> [!${type}] 标题\n> 在这里输入内容`, block: true })),
];
