# 阅读器“正在阅读”鼠标选中外框修复（巡舟，2026-09-22）

## 任务与结论

- 任务：`7ef5d0fd-e15d-4451-876e-925e0aa2fce0`，spec revision `2`。
- 分支：`fix/reader-selection-outline-xunzhou`。
- 实现提交：`36d9e6a`；随后把本地 `main` 的 `c22a5e0` 合入任务分支，合并提交为 `4f6482c`。
- 结果：鼠标按下、释放、重复点击、切换条目和返回 Reader 场景后，标题按钮都不再绘制矩形外框；选中状态只由整行浅绿色背景表达。键盘 `:focus-visible` 轮廓保留。

## 根因

`src/features/paper-notes.css` 原来把 Reader 行内所有 `button:active` 都设置为带 `inset 0 0 0 2px` 的强调色阴影。标题/内容本身也是原生按钮，所以真实鼠标按下时在已经有选中背景的 `<li>` 内又出现一层深绿色矩形框。

整行选中背景原本就由 `src/ui/styles/workbench.css` 的 `.scene-context-list > li.active` 提供；标题按钮不需要第二层选中反馈。

## 实现

1. 把 Reader 行内的 `:active` 反馈从广泛的 `button:active` 收窄到：
   - `.reader-paper-expand:active`
   - `.scene-context-item-close:active`
2. 不修改 Reader 行的 active 背景，不修改标题、PDF 标签、笔记数、长标题省略、行高或布局。
3. 保留原有、仅限 Reader 侧栏的 `button:focus-visible` 规则，因此键盘用户仍有清晰焦点提示。
4. 在 `scripts/verify-reader-list-browser.mjs` 增加真实 CDP 鼠标按下/释放和键盘焦点回归，并在该段之后重置夹具，避免影响既有展开、关闭和类型标签断言。

## 回归证据

### 浏览器夹具

- 修复前基线：`10/10`。
- 旧 CSS 红测：`25/26`，唯一失败为 `Mouse press keeps selected title borderless`；证据：`.a4-tests/reader-list/reader-list-2026-09-22T07-01-03-789Z`。
- 修复后首次绿测：`26/26`；证据：`.a4-tests/reader-list/reader-list-2026-09-22T07-01-53-170Z`。
- 合并最新 `main` 后复跑：`26/26`；证据：`.a4-tests/reader-list/reader-list-2026-09-22T07-30-49-955Z`。
- 断言覆盖：鼠标按下无 box-shadow/outline/border、释放后无残留、标题背景透明且只有行背景、键盘焦点可见、220/320px 宽度无溢出，以及既有展开/关闭/标签/笔记数/空状态行为。

### Windows/Tauri `dev:live`

- 隔离实例：`reader-outline-xunzhou`，应用身份 `app.aster.research.dev.reader-outline-xunzhou.w463f05006d`，未复制生产资料库。
- 官方运行时验证：`21/21`，mode `isolated`；日志：`.tmp/reader-selection-outline/dev-live/runtime.log`。
- 真实应用 raw-CDP 交互：`20/20`，覆盖两篇文献、真实 mouse-down/release、重复点击、条目切换、键盘 focus-visible、离开并返回 Reader、返回后重新选中、窄窗与 DPR `1.5`；`pageerror=[]`、`consoleErrors=[]`。
- 结构化结果：`.tmp/reader-selection-outline/dev-live/reader-evidence/result.json`。
- 截图：`.tmp/reader-selection-outline/dev-live/reader-evidence/screenshots/`。
  - `01-mouse-down-selected.png`：鼠标按下仅整行背景。
  - `02-mouse-selected.png`：释放后无外框残留。
  - `03-keyboard-focus-visible.png`：键盘焦点轮廓清晰保留。
  - `04-narrow-hidpi-selected.png`：响应式窄窗状态；侧栏样式和无横向溢出由同次 DOM 断言核验。
- 上述四张截图已人工检查；前三张直接展示鼠标与键盘状态，结果与结构化样式断言一致。

## 其他验证

- Reader/helper/UI 定向测试通过；Reader popover 布局 `166/166`。
- `npm run build` 在合并最新 `main` 后通过，`2623` modules transformed。
- `npm run verify` 在合并最新 `main` 后通过；命令 `cmd_6ad57009b92520acca4feb19030b1fc8351ee824312bb3fe`，Rust `215 passed / 0 failed / 5 ignored`，末尾为 `A4Note verification passed`；日志：`.tmp/reader-selection-outline/post-merge-verify-final.log`。
- MCP `src` diagnostics：`0`。
- `git diff --check`：通过。

## 范围边界

- 未修改 `ReaderSceneSidebar.tsx` 的选择、打开、展开或移除事件。
- 展开按钮与移除按钮仍保留鼠标按下反馈；其它场景的焦点样式不受影响。
- 未打包、未安装、未发布，未写入生产资料库。
