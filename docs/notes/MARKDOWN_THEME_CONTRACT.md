# Markdown 主题契约

> 状态：生效中。本文档描述 `src/ui/styles/markdown.css` 对外暴露的主题接口，是开发主题插件时唯一需要遵守的契约。
>
> 变量名和作用域由 `scripts/verify-architecture-boundaries.mjs` 断言锁定，改动这里的表格时必须同步改断言。

渲染后的 Markdown 只有一个样式归属：`markdown.css`，以 `.md-body` 为键。主题（内置或插件）**只覆盖 CSS 变量，不新增元素规则**。这条约束的目的是让「换主题」和「改排版」彻底分开——前者是数据，后者是代码。

---

## 1. 渲染面

四个面共享同一套内容样式，各自只保留自己的外框（内边距、宽度、滚动）。

| 面 | 类名 | 位置 |
|---|---|---|
| 笔记页阅读模式 | `.md-body.markdown-resource-preview.markdown-preview` | `features/explorer/MarkdownResourceTab.tsx` |
| 阅读器正文 | `.md-body.markdown-reader-content` | `features/reader/ReaderMarkdown.tsx` |
| 阅读器笔记预览 | `.md-body.markdown-preview.note-preview-only` | `features/reader/ReaderMarkdown.tsx` |
| 实时编辑器（源码装饰） | `.markdown-live-codemirror` + `.cm-md-*` | `features/explorer/MarkdownLivePreviewEditor.tsx` |

前三个走 ReactMarkdown，DOM 由 `src/shared/markdown/` 的共享组件产出，所以三个面的结构完全一致。第四个是 CodeMirror 装饰，只共享 `--md-*` 变量，不共享选择器。

**新增渲染面的唯一要求**：在容器上加 `md-body` 类。不要复制元素规则。

---

## 2. 基础色变量

声明在 `.md-body, .markdown-live-codemirror` 上。主题覆盖这一组即可改变整体观感。

| 变量 | 默认值 | 作用 |
|---|---|---|
| `--md-heading` | `#263d32` | H1–H6 基准色；H2/H3 在此基础上按比例混入 `--accent-strong` |
| `--md-heading-muted` | `#52675b` | H4–H6 的弱化色 |
| `--md-link` | `#2f6f55` | 正文链接、`[[wiki]]` 链接 |
| `--md-quote` | `#5f7869` | 引用块左边框 |
| `--md-highlight` | `rgba(206,177,66,.3)` | `==高亮==` 和 `<mark>` 底色 |
| `--md-code-bg` | `#202a24` | 代码块卡片底色 |
| `--md-code-ink` | `#edf3ef` | 代码块前景色 |
| `--md-code-muted` | `#aebdb3` | 代码块语言徽标 |

---

## 3. 代码高亮变量

声明在 `.md-body` 上。语法高亮由 `@lezer/highlight` 的 `classHighlighter` 输出 `tok-*` 类名，颜色全部走变量，不内联。

| 变量 | 默认值 | 覆盖的 token |
|---|---|---|
| `--md-tok-comment` | `#7f9689` | `comment` `lineComment` `blockComment` `docComment`（另加斜体） |
| `--md-tok-keyword` | `#dfa2ab` | `keyword` `controlKeyword` `definitionKeyword` `moduleKeyword` `operatorKeyword` `modifier` `self` |
| `--md-tok-string` | `#cfd28c` | `string` `string2` `docString` `character` `attributeValue` `regexp` |
| `--md-tok-number` | `#e0b189` | `number` `integer` `float` `unit` |
| `--md-tok-constant` | `#c8b6e6` | `bool` `null` `atom` `constant` `escape` `color` |
| `--md-tok-function` | `#9ec8e8` | `function` `macroName` `labelName` `link` `url` |
| `--md-tok-type` | `#8fd1bd` | `typeName` `className` `namespace` `tagName` |
| `--md-tok-operator` | `#b6c8bd` | 全部 `*Operator` |
| `--md-tok-punctuation` | `#9fb3a7` | `punctuation` `separator` 各类括号 |
| `--md-tok-meta` | `#93a89b` | `meta` `documentMeta` `annotation` `processingInstruction` |
| `--md-tok-invalid` | `#f0908a` | `invalid`（另加波浪下划线）、`deleted` |

`propertyName` / `attributeName` / `variableName2` 由 `--md-tok-function` 与 `--md-code-ink` 混合得出，不单独暴露变量。

**注意**：代码卡片在所有主题下都是深色，所以这一组只有一套值。如果主题要做浅色代码块，需要同时覆盖 `--md-code-bg`、`--md-code-ink` 和全部 11 个 `--md-tok-*`，否则对比度会不足。

---

## 4. 标注块（callout）变量

声明在 `.md-body blockquote.markdown-callout` 上，13 种类型各自覆盖三个变量。

| 变量 | 作用 |
|---|---|
| `--callout-color` | 主色：左侧色条、图标、类型标签、边框混色基准 |
| `--callout-bg` | 正文区底色（与 `--surface` 混合后使用） |
| `--callout-header-bg` | 标题栏底色 |

内置类型与默认主色：

| 类型（别名） | 主色 |
|---|---|
| `note` / `info` | `#2b7774` |
| `tip` / `hint` | `#687f38` |
| `important` | `#2e718d` |
| `warning` / `caution` | `#a16f25` |
| `danger` / `error` | `#ad514e` |
| `success` / `check` | `#367b57` |
| `question` / `help` | `#71609a` |
| `quote` | `#6d6b70` |
| `example` | `#76559a` |
| `abstract` | `#337a78` |
| `todo` | `#9a5b32` |

图标是 lucide 组件，在 `src/shared/markdown/MarkdownCallout.tsx` 里按类型映射，**不通过 CSS 变量控制**。主题想换图标需要改组件，不属于主题契约范围。

---

## 5. 从 tokens.css 继承的变量

Markdown 样式还会读取全局 token。主题改这些会同时影响整个应用，不只是 Markdown。

| 变量 | 在 Markdown 中的用途 |
|---|---|
| `--ink` | 正文色、加粗色 |
| `--muted` | 脚注区、题注、`<small>`、删除线 |
| `--line` | 表格边框、分割线、脚注区分隔线 |
| `--accent` / `--accent-soft` / `--accent-strong` | 行内代码、表头、列表 marker、链接 hover、任务复选框 |
| `--surface` / `--surface-soft` | 表格斑马纹、行内代码、callout 混色基准 |
| `--font-document` / `--font-code` | 正文与等宽字体 |
| `--document-font-size` | H1–H6 全部按它换算（H1 = ×2，H2 = ×1.45，H3 = ×1.2，H4 = ×1.05） |
| `--document-line-height` | 正文行高、题注行高 |

---

## 6. 根属性开关

挂在 `document.documentElement` 上，由 `App.tsx` 依据设置写入。主题插件可以读，但不应该自己改。

| 属性 | 值 | 影响 |
|---|---|---|
| `data-theme` | `paper` / `midnight` / 未设置 | 切换全局与 Markdown 色板 |
| `data-document-layout` | `narrow` / `fluid` | 正文最大宽度（760px 居中 / 全宽） |
| `data-document-line-height` | `compact` / 未设置 | 行高，且表格内边距随之收窄 |
| `data-markdown-paragraph-indent` | `true` / 未设置 | 段首缩进两字符 |
| `data-markdown-title-align` | `left` / `center` / `right` | 文档标题对齐 |
| `data-document-font` / `data-code-font` | 见 tokens.css | 字体族 |

对应的插件设置注册在 `src/core/markdownPlugin.ts`：`markdown.documentLayout`、`markdown.titleAlignment`、`markdown.documentFontSize`、`markdown.paragraphIndent`。

---

## 7. 主题接入模板

一个主题只需要这样一段。作用域必须同时带上 `.md-body` 和 `.markdown-live-codemirror`，否则实时编辑器的装饰会和阅读态脱节。

```css
:root[data-theme="your-theme"] .md-body,
:root[data-theme="your-theme"] .markdown-live-codemirror {
  --md-heading: #...;
  --md-heading-muted: #...;
  --md-link: #...;
  --md-quote: #...;
  --md-highlight: rgba(...);
  --md-code-bg: #...;
  /* 只在改成浅色代码块时才需要这两个和全部 --md-tok-* */
  /* --md-code-ink: #...; */
  /* --md-code-muted: #...; */
}
```

callout 想换配色就再补一段：

```css
:root[data-theme="your-theme"] .md-body blockquote.markdown-callout.markdown-callout-warning {
  --callout-color: #...;
  --callout-bg: rgba(...);
  --callout-header-bg: rgba(...);
}
```

内置 `midnight` 主题就是这个模板的实例，见 `markdown.css` 末尾。它只覆盖了 6 个变量（`--md-heading`、`--md-heading-muted`、`--md-code-bg`、`--md-link`、`--md-highlight`、`--md-quote`），其余沿用默认值。

---

## 8. 主题不该做的四件事

这些不是风格建议，是会破坏契约的操作，`verify-architecture-boundaries.mjs` 会拦住其中大部分。

1. **不要在 `reader.css` / `workbench.css` 里写 Markdown 元素规则。** 这两个文件曾经各存一份 md 样式，加上 `workbench.css` 里的第三份，同一段文档在三个面长得不一样。断言现在禁止 `.markdown-preview blockquote`、`.markdown-resource-preview table` 这类选择器复活。
2. **不要用 `!important`。** `markdown.css` 最后 import，`.md-body` 已经是最终裁决者；需要 `!important` 说明选择器写错了位置。现有的几个 `!important` 只用于压制标题的 `text-decoration`，是历史补丁，不要新增。
3. **不要写裸元素选择器。** 曾经有一条全局 `mark { display: block }` 躺在 PDF 骨架屏那组样式里，把所有行内高亮撑成了块级。所有规则必须以 `.md-body` 或明确的组件类开头。
4. **不要覆盖布局。** 内边距、宽度、滚动属于渲染面自己（`reader.css` / `workbench.css`），主题只管颜色和字体。改了布局会让四个面的对齐失配。

---

## 9. 已知缺口

| 缺口 | 现状 | 影响 |
|---|---|---|
| `paper` 主题没有 md 色板 | 沿用亮色默认值 | `paper` 是偏暖的纸色（`--surface-soft: #f0ede4`），Markdown 正文的冷绿色调与之略有出入 |
| `--md-tok-*` 只有一套 | 深色卡片专用 | 想做浅色代码块必须整组覆盖，见第 3 节 |
| callout 图标不可配 | 硬编码在组件里 | 主题换不了图标，只能换颜色 |
| CodeMirror 侧图标另有一套 | `workbench.css` 用 CSS `content: 'i'/'✦'/'!'` 字符 | 同一个 callout 在源码态和阅读态图标不同源 |

---

## 10. 校验

改这份文档涉及的内容时，跑：

```bash
npx tsc -b
node scripts/verify-all.mjs
```

其中 `verify-architecture-boundaries.mjs` 锁定的与本文相关的点：

- `markdown.css` 必须最后 import，且必须定义 `.md-body`、`.md-body blockquote.markdown-callout`、`.md-body table`、`.md-body :not(pre) > code`、`.md-body .footnotes`、`.md-body .tok-keyword`
- `reader.css` / `workbench.css` 不得再出现 md 元素级规则，不得出现裸 `mark {`
- 三个 ReactMarkdown 渲染面必须挂 `md-body`，且必须使用 `src/shared/markdown` 的共享组件
- `src/shared/markdown/*` 不得 import `core` / `platform` / `features` / `ui`（`shared` 是最底层，见 `ARCHITECTURE.md` 第 5 节）
