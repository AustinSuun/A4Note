# 阅读器「正在阅读」展开按钮绿色外框移除任务派发记录

任务卡：`3580532a-21e8-4806-b7c5-8909f27caa16`（本机看板 · queued · normal · rev 2）
派发者：arena（远程 MCP 会话，代号「竞场」）
日期：2026-09-22

## 用户反馈

「正在阅读」列表条目左侧的展开/收起按钮（`src/features/reader/ReaderSceneSidebar.tsx` 的 `.reader-paper-expand`）
点击后带一圈绿色外框，用户要求去掉。参考截图已作为任务附件 `reader-expand-outline-reference.png` 上传。

## 派发前定位（供执行者核对，非最终根因）

`src/features/paper-notes.css` 对该按钮叠加了三层强调色框：

| 行 | 选择器 | 效果 |
| --- | --- | --- |
| L43-46 | `.reader-paper-expand:hover` | `border-color: var(--accent)`（点击后鼠标仍停留时持续可见） |
| L47-50 | `.reader-paper-expand:active` | `box-shadow: inset 0 0 0 2px var(--accent)` |
| L31 | `.reader-paper-expand:focus-visible` | `outline: 2px solid var(--accent)` |

已归档任务 7ef5d0fd 去掉了标题按钮的外框，但按当时设计保留了展开/关闭按钮的按下反馈；本卡在其基础上继续收敛：
鼠标路径只保留浅色背景与图标颜色变化，关闭按钮 `.scene-context-item-close` 同步处理，键盘 `:focus-visible` 保留。

## 范围边界

- 只改 Reader 侧栏这一行的两个图标按钮样式，不改事件、整行选中背景及其它场景的按钮样式。
- 回归落在 `scripts/verify-reader-list-browser.mjs`（现有 26 项）。
- 本会话只发布任务，未领取、未执行、未改动 `src/`；未推送、未打包。
