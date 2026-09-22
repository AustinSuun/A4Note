# 阅读器笔记边缘把手交接（星序，2026-09-22）

任务：`9b69c4b5-729c-4ee0-b8d7-03c0ddf882eb`，spec 3；分支 `feat/note-edge-xingxu`；独立 worktree `.worktrees/note-edge-xingxu`。本文是开发者验证记录，不替代用户/独立 Agent 验收。

## 实现与交互决定

- 删除标题栏及其响应式溢出区的旧「笔记工作台」入口。唯一主入口改为内容边界书签：收起时 22×88px、NotebookPen14 和竖排「笔记」；打开时 16×56px、强调色箭头。
- PDF 专注/悬浮时贴内容右缘；任意右侧面板打开时骑在分隔条上，同步跟随宽度；写作时在内容左缘，返回进入写作前的模式，与 Escape 一致。垂直居中排除实际底部标注工具坞。
- 共用 `useReaderDrawerGesture`：移动 <4px 是点击，≥4px 才拖宽，400ms 长按菜单；处理 pointer capture、取消/卸载、Escape 和最后一个 pointerup 样本。缩放归一化后通过原布局 setter 写回按论文比例；拖动期间无宽度过渡。
- 右键、长按、Up/Down、Shift+F10 打开向内的 body-portal 菜单。四态 radio、可见勾选、绑定键帽、Home/End/Escape、焦点回退与视口/缩放夹取完整保留。
- **新建文档选择放在把手菜单**：右键把手 → 新建文档，两次操作；**历史选择保留在新文档标题下拉**：点击把手 → 点击文档标题，两次操作。新建委托当前 ReaderMarkdown 原有 `createNote()`，未挂载时只排队一次，复用保存/选择/重复请求保护，不直接调用绕过编辑会话的后端创建函数。
- **保留主分支新侧栏的单行标题栏**，不恢复已移除的笔记 workspace tab/关闭/+ 行、不新增头部新建图标。把三态紧凑模式按钮接入现有文档头部；窄卡已保存状态保留图标、文字语义与 tooltip。
- 悬浮卡夹取为把手和拖动控件预留右侧/顶部28px。Reader 自身按真实 html CSS zoom 限制可用宽度，避免宿主 min-width980 在 UI150 下把把手推出屏幕；不改全局壳、PDF 渲染、标注、图层、橡皮或底部工具栏。
- 四态模型、按论文存储、命令 ID、Ctrl+Alt+N/2/3/4/Q/P 默认键位和 Ctrl 引导前缀规则未改变。快捷键提示锚点迁到真实把手。

## 并行整合

先后保留并合入 main 的文本 B/I、工具坞高度、笔记侧栏精简、任务标题栏拖动、树形彩虹线及阅读列表按钮边框修复。最新验证基线 `9c1f3d4d12e0038c0c9960017a502e87e440b644`；合并到任务分支为 `aaeb146`。共享状态冲突逐项合并，只更新本任务条目，不代提交其他 Agent 的 UI 工作。最终交付和 main 包含 SHA 见任务卡 delivery/integration 记录。

## 验证

| 检查 | 最终结果 |
| --- | --- |
| `test:note-workbench` | 57/57 |
| `test:note-workbench-browser` | 84/84；保留并适配原42项 |
| Reader、UI-state、architecture | 通过 |
| `test:reader-note-sidebar` / sidebar-browser | 16/16；浏览器通过，errors=[] |
| 最新main整合后的完整 `verify`（含 build） | 退出0，明确输出 A4Note verification passed；前置browser+verify组合248.346秒 |
| Rust | 215通过，0失败，5 ignored |
| 原生主流程 | 158项 / 13图，errors=[] |
| 原生缩放/持久化/滚动补充 | 18项 / 3图，errors=[] |
| 新标题栏/首次新建/草稿/240px卡片 | 20项 / 4图，errors=[] |
| MCP diagnostics（src） / `git diff --check` | 0诊断 / 通过 |

最终浏览器结果：`.tmp/shots/note-workbench/run-2026-09-22T13-39-50-619Z/result.json`。完整日志 `.tmp/edge/verify-latest-main.log`；原生日志 `.tmp/edge/{native,extra,header}-latest-main.log`。三组原生合计196项通过。

原先基线42项通过，新增内容区入口检查失败（42/43），确认旧入口不能满足方案C；新脚本保留原42项的行为覆盖，按入口搬迁修正选择器，再增加边界停靠、阈值、菜单、卡片、返回、提示锚点及可见勾选等覆盖。

## 原生取证与边界

官方命令：`npm run dev:live -- --instance note-edge-xingxu --port 1477 --cdp-port 9277`。真实 Windows/Tauri WebView，独立身份 `app.aster.research.dev.note-edge-xingxu.w03692c2428`，DEV 条显示原生已核验。只使用隔离测试库里已有的 Mean Flows 副本，没有复制生产库或再次导入论文。

证据根目录 `.tmp/shots/note-edge-native/`：

- `00-real-pdf.png`：修改前真实标题栏。
- `final/`：浅/深四态、Ctrl 键帽锚点、UI缩放压力、高PDF缩放等。
- `extra/matched-after-reading.png`：UI100/PDF118/同侧栏状态的修改后配对图。
- `extra/`：UI125/150宽屏分栏、慢拖、持久化、reduced-motion、滚动验证。
- `header-integration/`：菜单新建、未挂载编辑器首次创建、真实草稿刷新后保存、240px最小卡片在UI100/125/150下各个头部按钮命中与实际切换。

**不夸大测试范围：**

1. UI125/150使用受控 CSS zoom；设置 UI 的实际最高值是140，未宣称原生设置可选择150。额外宽屏125/150测试用 CDP1600×1000视口，之后清除；头部最小卡片补充使用CDP1024×820，尾部1600×1000验证离开临时窄窗状态。其余主流程图为实际原生窗口。没有宣称不同物理显示器/DPR全覆盖。
2. 基线产品刻意隐藏 PDF 滚动条。额外测试临时显露已有原生滚动条，验证把手高度以外可拖后立即去掉探针 CSS；产品未新增滚动条，不能将此解释为正常界面常驻可见滚动条。
3. 全局「打开标注/对话面板」命令会选择阅读器场景 tab，可能露出空场景页；测试通过实际 Ctrl+3 返回当前论文后测停靠/拖动。该导航行为不在本卡范围，未改全局命令或面板业务逻辑；不把场景页空白截图充当把手证据。
4. 原生脚本初期旧「+」选择器与新侧栏不兼容；曾验证 popup portal 并确认问题是旧触发器而非弹层，已撤回该改动。最终验证使用新 UI 的真实入口。等待布局稳定和异步新建真正完成后才测几何/文档数，不靠删除断言通过；最小宽度测试同时考虑既有24%比例下限和240px CSS下限。
5. Rust 构建可能打印既有 unused-import/dead-code 警告；WebView 正常流程 console/pageerror 单独收集。生成 Cargo/schema 的换行变化在停止自身实例后归一比较并单独恢复，不混入产品提交。

## 回归方式

```text
npm run test:note-workbench
npm run test:note-workbench-browser
npm run test:reader
npm run test:reader-note-sidebar
npm run test:reader-note-sidebar-browser
npm run test:ui-state
npm run test:architecture
npm run verify
```

完整 verify 包括 build、前端回归及 Rust tests。原生驱动与结果、浏览器结果、日志随证据包上传任务；不要使用残留 `failed.png`、加载态 initial 图或旧未完成 menu/result 作为通过证据。

下一步：由用户验收；本任务仅在交付SHA被本地main包含后提交review，最终合并确认见任务卡。未打包、安装、推送或发布应用。
