# 笔记界面文件页签：HTML 渲染预览与图片预览（4f5b33dd · arena-b · 2026-09-29）

- 任务：`4f5b33dd-9f8a-410b-b355-ab0dfbf55c73`（spec 2），执行者 arena-b（agent a4f50d11）
- 分支 / worktree：`feat/file-preview-arena-b` / `.worktrees/file-preview-arena-b`，基线 `c6e8217`，rebase 到本地 main `471953f`
- 实现提交：见任务 delivery（本文档随文档提交一起进入同一分支）

## 1. 问题

通用文件页签 `src/features/explorer/FileTab.tsx` 只调用 `readTextFilePreview`：HTML 永远以 `<pre>` 源码显示，头部是「?」图标；PNG/JPG 等因含 NUL 被 Rust 判为二进制，落到「暂不支持预览」。改前取证（dev:live 隔离实例，浅色）：

| 截图 | DOM 断言 |
|---|---|
| `before-1-html-source.png` | `pre.file-tab-preview` 存在，无 iframe |
| `before-2-png-unsupported.png` | `.file-tab-empty-state`「暂不支持预览」 |
| `before-3-svg-source.png` | SVG 以 `<pre>` 源码显示 |

## 2. 方案

新增三个 explorer 内模块，`FileTab.tsx` 在其上扩展；未改 `App.tsx`、`workbench.css`、`tokens.css`、`types.ts`、`lib.rs`、Rust 与 `tauri.conf.json`。

| 文件 | 作用 |
|---|---|
| `src/features/explorer/filePreview.ts` | 纯规则：扩展名 → `image` / `html` / `text`；上限（图片 20 MB，与 Markdown 本地图片一致；HTML 5 MB）；`HTML_PREVIEW_SANDBOX = ''`；文档级 CSP；HTML 字节解码（BOM → 声明的 charset → 严格 UTF-8，失败返回原因）；每文件「预览/源码」记忆（localStorage `a4note.filePreview.htmlMode.v1`，最近 200 个文件，存储异常时静默不记） |
| `src/features/explorer/htmlPreviewDocument.ts` | 用 `DOMParser`（惰性文档：不执行脚本、不发请求）把 HTML 处理成自包含的 `srcdoc` |
| `src/features/explorer/file-tab-preview.css` | 分段切换按钮、图片舞台（棋盘格底、适应/实际大小）、提示、白底 iframe；`.file-tab*` 共享规则保持不动 |
| `src/features/explorer/FileTab.tsx` | 按种类分派；图标 `FileImage` / `FileCode2` / 原 `FileQuestionMark` |
| `src/ui/zh.ts` | `zh.workbench` 只新增 17 条文案，未删改已有条目 |

### 2.1 图片（png/jpg/jpeg/gif/webp/svg/avif/bmp/ico）

- 先用既有 `readTextFilePreview` 拿到字节数（Rust 端只读 256 KB 前缀），>20 MB 直接提示「这张图片 22.3 MB，超过 20.0 MB 的预览上限，没有载入。」，**不读取文件**。
- 否则直接复用 `loadNoteImage(path, encodeURIComponent(basename))`：与 Markdown 本地图片同一套路径归一化、scheme/UNC 拒绝、MIME 白名单、20 MB 上限与飞行中去重。
- `<img>` 居中；「适应窗口」只用 `max-width/max-height: 100%`（**小图不放大**，1:1 显示），「实际大小」为原始像素并可滚动。头部元信息：文件大小 + `onLoad` 读到的 `naturalWidth × naturalHeight`。
- SVG **只经 `<img>` 的 data URL** 显示（图片上下文中脚本与外部引用都不执行），不把 SVG 源码注入 DOM。
- 解码失败（`onError`）提示「图片无法解码，文件可能已损坏，或格式不受支持。」；SVG 解码失败时改为提示 + 源码视图。

### 2.2 HTML（html/htm）

默认渲染，头部「预览 / 源码」切换，按文件记忆。渲染路径：

1. 超过 5 MB → 提示「这个 HTML 文件 6.4 MB，超过 5.0 MB 的渲染上限，已改为源码视图。」+ 原有 `<pre>`（含截断提示），**不整读文件**。
2. `readFileBytes` 读取**完整**字节（不基于截断文本），`decodeHtmlBytes` 解码：
   - 有 BOM（UTF-8 / UTF-16LE/BE）按 BOM；
   - 前 1024 字节内 `<meta charset>` / `http-equiv Content-Type` 声明的编码（如 GBK、GB2312、Shift_JIS）用 `TextDecoder`；
   - 否则严格 UTF-8；**未声明且非 UTF-8** → 「文件不是 UTF-8 编码，也没有声明 charset，无法可靠渲染，已改为源码视图。」（不渲染乱码）；声明了无法识别的编码 → 对应提示。非 UTF-8 渲染时元信息显示「按 GBK 解码」。
3. `buildHtmlPreviewDocument` 处理（全部在惰性 DOM 上完成，之后才渲染）：
   - 删除 `script`、`iframe/frame/frameset/object/embed/portal/applet`、作者的 `<base>`、`meta refresh`、所有 `on*` 属性、`javascript:`/`vbscript:` URL；`<form>` 换成普通容器（无法提交，也就不会产生沙箱拦截报错）；
   - `#锚点` 链接改写为 `about:srcdoc#锚点`，文档内目录跳转照常可用；其他链接去掉 `href`（保留在 `data-a4-href` 与 tooltip 中），预览里点击不跳转；
   - 相对 `<img src>` 经 `resolveNoteImagePath` + `loadNoteImage` 内联为 data URL（同目录 `./img/diagram.png` 实测可见）；读取失败或不在白名单的计数，元信息显示「N 张本地图片无法载入」；`srcset` 移除；
   - 其余相对 URL 属性一律移除（在 srcdoc 中它们会相对应用自身源解析）；
   - 在 `<head>` 最前插入文档级 CSP `<meta>`、`<base href="about:blank">`（CSS 中残留的相对 URL 也无法指向应用源）和一条零优先级的惰性链接样式；保留原 doctype（无 doctype 的页面仍按怪异模式渲染，与浏览器一致）。
4. `<iframe sandbox="" srcdoc=… referrerpolicy="no-referrer">`，iframe 本身白底、`color-scheme: light`，深色主题下**不反色**，页面背景由文档自身决定。

### 2.3 安全模型

- `sandbox=""`：不含 `allow-scripts`、`allow-same-origin`、`allow-forms`、`allow-popups`、`allow-top-navigation`。**不提供脚本开关**（见 2.4 的实测：宿主会把 Tauri IPC 对象注入每个 frame，一旦允许脚本，预览内容至少能接触到这个桥接对象）。
- 文档级 CSP：`default-src 'none'; img-src data: http: https:; style-src 'unsafe-inline' data: http: https:; font-src data: http: https:; media-src data: http: https:; form-action 'none'`——即使沙箱被放宽，脚本、子框架、对象、fetch/XHR、表单提交仍被拦截。
- **应用全局 CSP 未改**（`tauri.conf.json` 现状无 CSP）。
- 远程资源说明（WebView2 + 当前无全局 CSP）：远程**图片、样式表、字体、音视频**可按上面的文档 CSP 加载（与 Markdown 远程图片策略一致）；远程**脚本**不会执行（已删除 + 沙箱 + CSP 三重）；远程 iframe/object 已删除；表单与页面跳转不可用。离线时远程资源只是空缺，不影响渲染。
- 仓库级回归断言 `FileTab.tsx` / `htmlPreviewDocument.ts` / `filePreview.ts` 中不出现 `allow-scripts|allow-same-origin|allow-top-navigation|allow-popups|dangerouslySetInnerHTML`，也不引用任何写文件 API。

### 2.4 原生 WebView 中每个沙箱 frame 的一条宿主日志（已查明，非应用错误）

在 dev:live（Tauri/WebView2）里，每**新建**一个预览 iframe，DevTools 会记录一条 `security` 级别日志「Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed…」。对照实验（raw CDP，不经 Playwright，见 `.tmp/shots/4f5b33dd/` 与下方步骤）：

| 操作（在应用页面控制台里动态创建） | 新增日志 |
|---|---|
| `<iframe sandbox="" srcdoc="<p>plain</p>">`（与本功能无关的最简沙箱 frame） | 1 |
| `<iframe srcdoc="<p>plain</p>">`（不加 sandbox） | 0 |
| 再次创建最简沙箱 frame | 1 |

同时在预览 frame 内（DevTools evaluate）能看到 `window.__TAURI_INTERNALS__` 为 object：宿主在每个 frame 创建时注入初始化脚本，其中需要执行的部分被沙箱拦下，这就是这条日志的来源。普通 Chrome（浏览器回归）渲染同一探针为 **0 条**。结论：这是沙箱在起作用，与预览文档内容无关；除此之外应用 console / pageerror 为 0。另：Playwright 连接 / 点击时会向 OOPIF 注入辅助脚本并产生同样的日志，因此原生取证改用 raw CDP 驱动（`.tmp/arena-b/cdp-raw.mjs`，Log/Runtime 只统计本次运行之后的条目）。

### 2.5 保持不变

- 其他文本文件（txt/json/css/js/…）仍为 `<pre>` 源码预览与截断提示；真正的二进制仍为「暂不支持预览」；Markdown / PDF / 白板页签路径未改；文件树类型徽标 `fileTreeDisplayName.ts` 未改。
- 打开文件只读：原生取证前后 `preview-samples` 下 30 行快照（路径、大小、mtime、sha256）逐字相同（`fs-before.txt` / `fs-after.txt`）；浏览器回归断言 mock 只收到 `readTextFilePreview` / `readFileBytes`。
- 过期结果：原先 `preview` 是无主状态，切换文件后的第一帧仍携带上一个文件的结果——对图片会让新挂载的 `ImagePreview` 按旧文件大小去读新文件（浏览器回归抓到：切到 23 MB 图片时仍读取了一次）。改为 `{ path, preview }` 按路径归属，子组件各自用 `cancelled` 标志并以 `key={path}` 挂载；视图状态（适应/实际、尺寸、预览/源码）同样按路径归属。

## 3. 回归测试（均已接入 `npm run verify`）

- `npm run test:file-preview`（`scripts/verify-file-preview.mjs`，Vite `ssrLoadModule`）：扩展名判定（含 `.png`、`x.html.bak`、`x.svgz` 等反例）、上限、`sandbox === ''`、CSP 不含 script/frame/connect/object 源、源码中无放宽沙箱与写 API、BOM/声明/严格 UTF-8/未声明 GBK/未知编码/1024 字节预扫描窗口、预览/源码记忆（按文件、200 上限、损坏存储、写入异常）。**旧代码：`filePreview.ts is missing` 失败。**
- `npm run test:file-preview-browser`（`scripts/verify-file-preview-browser.mjs`，Playwright 挂载真实 `FileTab`，`../../platform/projects` 用 alias 换成 fixture mock）：
  - PNG 64×40 以 data URL 显示、居中、不放大、元信息含像素；2400×1800 适应缩小且比例正确，「实际大小」为 2400 宽并可滚动；
  - SVG 经 `<img>`、其内脚本与 `onload` 不执行、无内联 SVG；残缺 SVG → 提示 + 源码；
  - 损坏 PNG → 解码失败提示；23 MB PNG → 上限提示且**从未读取**；
  - 探针 HTML：`sandbox=""`、无 `src`、srcdoc 含 CSP 且无 `<script` / `on*=`；frame 内 `noscript` 可见、相对图片已内联（90px）、缺失图片计数 2、锚点为 `about:srcdoc#sec2`、外链与 `javascript:` 无 href、无 iframe/object/script；宿主 `document.title`、`window.__pwned`、`localStorage.pwned`、`window.name` 均未变；真实鼠标点击外链与提交按钮后 frame 仍在 `about:srcdoc`；点击锚点后在 frame 内滚动到 `#sec2`；
  - 切到源码后，离开再回来仍为源码；
  - 6.7 MB HTML → 提示 + 源码且**从未整读**；未声明 GBK → 提示 + 源码；声明 GBK → 渲染出「中文」并显示「按 GBK 解码」；
  - txt / json / bin 行为不变；
  - 响应乱序（随机 0–160 ms 延迟）下连续快速切换 10 个文件三轮（结尾分别为 txt / png / html），最终只显示最后一个文件；
  - `midnight` 主题下 iframe 背景仍为白色、无 filter；
  - 整个流程 console/pageerror/HTTP ≥400/对 example.invalid 等被删资源的请求为 0。唯一放行的是 Playwright 向沙箱 frame 输入时产生的同一条「Blocked script execution in 'about:srcdoc(#sec2)'」（正则精确匹配；渲染阶段先严格断言 0 条）。raw CDP 对照（`rawcdp-click-evidence.json`）证明真实点击同样元素不产生任何日志。
  - **旧代码：`PNG must not fall back to "暂不支持预览"` 失败**（`old-code-tests.txt`）。

## 4. dev:live 原生取证（改后）

实例 `arena-b`（`app.aster.research.dev.arena-b.w1afa4862d9`，端口 1451 / CDP 9251，独立测试库，未触碰正式库与 4319）。样例 `.tmp/arena-b/preview-samples/`（由 `.tmp/arena-b/mkpreview.mjs` 生成，GBK 用 iconv 转码）。截图 `.tmp/shots/4f5b33dd/`：

| 截图（light / dark） | 关键断言（raw CDP DOM 检查） |
|---|---|
| `after-*-01-html-render` | `实验/LNN点云识别设计-跨尺度演化.html`：图标 file-code、「预览*」、iframe `sandbox=""`、CSP、无 script/handler；frame 内相对图片内联（480px）、目录锚点 `about:srcdoc#goal/#arch/#plan`、外部参考 inert；iframe 白底，文档自身背景 `rgb(246,248,251)`，filter none |
| `after-*-02-security-probe` | frame 内：`#executed` 不存在、`body onload` 未执行、`noscript` 可见、脚本 0、`window.name` 空；cookie / localStorage / `parent.document` 访问均 `SecurityError`；宿主标题仍 `A4Note`、`localStorage.pwned` null、cookie 无 pwned；元信息「1 张本地图片无法载入」 |
| `after-light-03-html-source-toggle` | 切到源码 → `<pre>`；切到 notes.txt 再回来仍为源码（记忆） |
| `after-*-04-png` | photo.png 1100×700 适应显示 914×582、元信息「66.3 KB 1100 × 700 像素」 |
| `after-*-05-large-fit` / `after-light-06-large-actual` | 4000×3000（4.7 MB）适应 793×594；实际大小 4000×3000 可滚动 |
| `after-*-07-svg` | logo.svg（含 script）以 `<img>` 显示 320×200 |
| `after-*-08-huge-over-cap` | 22.3 MB PNG 上限提示 |
| `after-*-09-corrupt-png` | broken.png 解码失败提示 |
| `after-*-10-oversize-html` | 6.4 MB HTML 上限提示 + 源码 + 截断提示 |
| `after-*-11-gbk-undeclared` | 未声明编码提示 + 源码 |
| `after-*-12-gbk-declared` | 渲染「声明了 GBK 编码的网页 / 中文内容应正确显示。」，元信息「按 GBK 解码」 |
| `after-*-13-txt` / `after-light-14-json` / `after-*-15-bin` | 原样 `<pre>` / 「暂不支持预览」，无切换按钮，图标仍为 `?` |

原生 console：页面重载后，浅色全流程只有 2.4 节所述每个新建沙箱 frame 一条宿主日志（本轮新建 4 个预览 frame → 4 条），深色全流程（不新建 frame）0 条；无 pageerror、无 console.error。

## 5. 性能

- 读取、解码、DOM 处理全部异步；切换文件时旧结果按路径作废（见 2.5，浏览器回归乱序三轮通过）。
- 4000×3000 PNG（4.7 MB）在原生实例中直接调用同一 `loadNoteImage` + `img.decode()` 三次：读取 + 编码 1668 / 1527 / 1498 ms（异步，界面可操作），解码 63 / 5 / 3 ms，长任务 113 / 103 / 111 ms（每次一条，来自共享加载器在主线程把字节拼成 base64 data URL 以及 IPC 返回的数字数组）。这条约 110 ms 的长任务与 Markdown 本地图片相同；彻底消除需要把共享加载器改为 blob URL / 资源协议，这会同时影响 Markdown 图片与 2891f95a 的切换性能基线，本任务按要求复用加载器，不在此改动，列为后续项。
- 大 HTML 超过 5 MB 不整读；≤5 MB 时 DOMParser 处理在 3.4 KB 样例上不可感知。

## 6. 验证

- `npx tsc -p tsconfig.app.json --noEmit` 0；`npm run build` 通过；`npm run test:architecture` 通过。
- `npm run test:file-preview` PASS；`npm run test:file-preview-browser` PASS（rebase 到 `471953f` 后复跑）。
- PowerShell `npm run verify`（rebase 到 `471953f` 后）：仅 2 步未过——`test:ui-state`（`verify-ui-state.mjs:383`，main 既有失败）与 `test:note-enter-motion-browser` 一次进程崩溃（退出码 3221226505 = 0xC0000409，非断言失败；单独复跑 73/73 通过）。`test:file-preview` / `test:file-preview-browser` 在 verify 中 PASS，Rust 249 通过 / 0 失败 / 7 忽略。

## 7. 协同与限制

- 未改 3eabf1ac（笔记属性：`MarkdownPropertiesPanel` 等）与 4093839c（白板：`src/features/board/*`、`boardFiles.ts`）的任何文件。`package.json` / `scripts/verify-all.mjs` 是共享测试登记表，只追加两行。
- 预览中的外链不打开（可切到源码复制，或用标题栏「打开 ▾」用默认程序 / VS Code 打开）；表单不可提交；需要脚本的页面（图表、SPA）只显示静态部分和 `noscript` 内容——这是有意的安全取舍。
- HTML 中通过 CSS `url()`、`<video src>` 等引用的**本地**相对资源不内联（只内联 `<img>`），显示为空缺。
- 声明了编码但与实际不符的文件按声明解码（与浏览器一致）。
- 图片的「适应 / 实际大小」不做记忆，每次打开为适应窗口。
