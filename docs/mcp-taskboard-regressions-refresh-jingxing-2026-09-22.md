# 任务看板回归脚本刷新 — 竞行执行记录（2026-09-22）

- 任务：`4bc5d239-62a5-477e-bd13-d1cbe46c5b0f`（normal）「任务看板回归脚本过期：verify-task-stage-integration.mjs 与 verify-taskboard-compact.mjs 在当前 main 失败（评审摘要文案已改、字号快照漂移），需更新断言并评估纳入 verify-all」
- 执行：竞行（worker 会话 `arena-worker-jingxing`），分支 `fix/taskboard-regressions-refresh-jingxing`，基线 main `9bf90d4`，worktree 目录沿用 `.worktrees/task-titlebar-drag-jingxing`。

## 旧代码失败对照（main 9c1f3d4，`.tmp/jingxing/verify-*-main.log`）

| 脚本 | 失败点 | 真实原因 |
| --- | --- | --- |
| `verify-task-stage-integration.mjs` | 第 318 行 `textContent.includes('未提供结构化独立验收评价')` | 该句仍存在，但 `TaskReviewSummary.tsx` 重写后被收进默认折叠的「查看 证据说明与限制」disclosure（`.tb-secondary-disclosure` + 按需渲染的 `.tb-review-secondary-body`），静态 textContent 不再包含。 |
| 同上（318 行修好后才暴露） | 第 334 行等待 `dialog[open] textarea[aria-label="调整意见"]` 超时 | `TaskBoard.tsx` 的调整意见面板改为点「需要调整」（`aria-expanded` 切换 `feedbackOpen`）后才渲染 `tb-feedback-panel`，对话框打开时 textarea 不存在。 |
| `verify-taskboard-compact.mjs` | 第 144 行字号快照 deepEqual，期望 25/13/15/13/14/14px，实际 27/14/16/14/15/15px | 任务描述里"tokens 放大"的猜测不成立：`--ui-*` token 与这六个选择器无关。真实来源是 `taskboard.css` 末尾的「Taskboard readability」固定像素覆盖块（`.taskboard .tb-header h1 { font-size: 27px }` 等，L1006-1030）。该覆盖块与脚本快照同在整合提交 206b641 引入，快照抄的是 L94-307 的基础规则值，从引入那天起就没通过过。 |

两个脚本都不在 `scripts/verify-all.mjs` 里，所以腐化无人发现。

## 修改

| 文件 | 改动 |
| --- | --- |
| `scripts/verify-task-stage-integration.mjs` | 318 行改为语义谓词 `reviewHonesty(root)`：① `.tb-review-meta` 含「开发 Agent」出处；② 常显 `.tb-review-caution[role=note]` 含「开发自述不等于独立验收」；③ 全文不含「独立验收通过 / 验收通过 / 验收已通过 / 已通过验收」；④ 存在「证据说明与限制」disclosure。同一谓词再对一个被篡改的克隆（删掉 caution、追加「独立验收通过」）求值，断言其返回 `ok:false` 且 reasons 同时含 `caution note missing` 与 `verdict wording present` —— 内建反例，保证断言不可能恒真。随后点开 disclosure 断言「未提供结构化独立验收评价」仍在，再收起。对话框流程：等待 `.tb-review-buttons button[aria-expanded]`，先断言 textarea 默认不渲染，再点「需要调整」后等待 textarea，其余步骤不变。 |
| `scripts/verify-taskboard-compact.mjs` | 新增常量 `READABILITY_FONTS`（27/14/16/14/15/15px，注释指向 taskboard.css 的 readability 块与 206b641），144 行 deepEqual 改用它并带 `[width, zoom, sidebar]` 消息。硬编码理由：这些值在 CSS 里就是固定像素、不经 token 推导，"由 token 推导"无对象可推；快照的意义是保证六处字号在 1568/1280/1000 × zoom 1/1.25 × 侧栏开/关 12 组下恒定且等于可读性规范，读取 stylesheet 再比对会退化成恒真。 |
| `scripts/verify-all.mjs` | 在 `verify-task-binding-guide` 之后加入两个脚本。 |

`src/**` 无改动；未发现产品缺陷。

## 反例验证（`.tmp/jingxing/regressions/stage-probe.log`，临时副本打印谓词结果后删除）

```
HONEST_PROBE   {"ok":true,"reasons":[],"meta":"开发 Agent：测试执行者 · 需求 v1 · 提交记录 #8 · …","caution":"开发自述不等于独立验收；请按截图和报告核对实际效果，不推断全部通过。"}
TAMPERED_PROBE {"ok":false,"reasons":["caution note missing","verdict wording present"],"meta":"开发 Agent：测试执行者 · …"}
```

## 字号推导对照（`taskboard.css` L1006-1030 readability 块）

| 选择器 | 基础规则 | readability 覆盖（生效值） | 实测（12 组一致） |
| --- | --- | --- | --- |
| `.tb-header h1` | 25px（L96） | `.taskboard .tb-header h1` 27px | 27px |
| `.tb-project-name` | 13px（L100） | 14px | 14px |
| `.tb-column h2` | 15px（L199） | 16px | 16px |
| `.tb-column header p` | 13px（L227） | 14px | 14px |
| `.tb-empty` | 14px（L313） | 15px | 15px |
| `.tb-filters > input` | 14px（L167） | 15px | 15px |

## 验证

- 新代码：`verify-task-stage-integration.mjs` `{"passed":true,"checks":65}`；`verify-taskboard-compact.mjs` `{"passed":true,"checks":94}`。
- 稳定性 / 时长（`.tmp/jingxing/regressions/timing.txt`，连续 3 轮）：stage-integration 7729 / 7735 / 7592 ms，compact 3713 / 3803 / 3682 ms，6/6 通过 → 纳入 verify-all。
- `npm run verify`（独立控制台，导出 TASKS_EXPECTED_PROJECT_ID / TASKS_PROJECT_ROOT，`.tmp/jingxing/regressions/verify.log`）：VERIFY_EXIT 0，62 个 step 全部通过（含新加入的两条：compact 94 checks、stage-integration 65 checks；cargo test 215 passed）。
- `npm run build`：通过（vite built in 1.42s，BUILD_EXIT 0）。

## 边界

- 未打包、安装、发布；未触碰 4319 生产看板。
- 8cc3cc88 记录中"两脚本后段既有失败"的描述自此失效，本记录为准。
