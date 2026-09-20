# 任务详情弹窗验收视图精细优化（星桥执行，2026-09-20）

任务：ab3806ec-99fb-4323-8a9e-18d15fe308f3。分支：feature/task-detail-review-ui；工作区：.worktrees/task-detail-review-ui。
基线：本地 main 4b4f57a，另以独立提交 bba40b2 导入共享工作区中处于待检查状态的 f376994b 弹窗改动
（青澄代办、Arena 状态核查复验），本任务在其之上继续，避免覆盖该在途改动。

## 逐页问题清单（隔离浏览器实测，1366×768，修改前）

| 页面/状态 | 问题 | 实测 |
| --- | --- | --- |
| 验收与证据（默认） | 结果截图排在交付原文之后，首屏看不到图片 | 首张缩略图顶部距视口 1095px，正文可视区底部 535px；缩略图高 110px |
| 验收与证据 | 图片卡片里“选择对比”复选框继承看板全局 `label{display:grid}`/`input{padding}`，形成大块无效空白 | 卡片非内容空白 75px；单图仍显示对比控件 |
| 底部操作区 | “检查效果”说明 + 常驻多行反馈框 + 按钮 + 删除行，占满底栏 | 底栏 194px；归档按钮 124×36、14px；“需要调整”36px |
| 底部操作区 | 删除任务紧邻归档按钮下方（安装版为红色实心按钮） | 删除按钮常驻可见 |
| 任务要求 / 执行记录 / 完整历史 | 字号层级已由 f376994b 调整，主要问题是标题区与页签留白偏大，历史条目缺少分隔 | 头部 18px 内边距、页签 10px |

## 改动

- `TaskBoard.tsx`：底栏改为“更多操作（左，默认收起）｜说明 + 需要调整 + 效果满意归档（右）”。反馈框默认不显示，
  点击“需要调整”展开面板（自动聚焦），可“收起（保留已写内容）”或“提交调整意见并退回”；仅服务受理后才清空草稿。
  删除任务收进“更多操作”里的危险区，附后果说明，仍需确认；已归档任务不再渲染空底栏。
- `TaskImageViewer.tsx`：附件卡片以图片为主体（16:10、最高 420px、悬停“查看大图”），文件名/说明/操作分行；
  对比控件改为紧凑勾选角标，仅在有两张及以上可预览图片时出现；说明最多两行，完整内容悬停可见。
- `TaskReviewSummary.tsx`：弹窗内标题为“交付成果与实际效果”，元数据右对齐弱化；顺序改为结果截图 → 交付结论 →
  证据说明与限制（折叠）→ 参考图/其他附件（折叠）。阶段工作区仍显示任务标题与“打开完整详情”。
- `taskboard-dialog.css` / `task-review-summary.css`：上述布局、44px 主操作、危险区样式、窄窗口（≤900px）时两组操作分行并以虚线分隔。
- 新增 `scripts/verify-task-detail-review-ui-browser.mjs`：真实 TaskBoard + 隔离合成任务服务 + 无头 Chrome，
  产出前后截图并断言；`scripts/verify-task-detail-modal.mjs` 增至 37 项。

## 前后测量（同一夹具，1366×768，未最大化）

| 指标 | 修改前 | 修改后 |
| --- | --- | --- |
| 归档按钮 | 124×36，14px | 176×44，16px |
| “需要调整” | 36px | 44px |
| 底栏高度 | 194px（含常驻反馈框） | 69px（反馈框按需展开） |
| 删除任务 | 常驻可见，紧邻归档 | 收起在“更多操作”，展开后与归档水平相距 ≥160px，窄窗口分行 ≥32px |
| 首张结果图 | 顶部 1095px（首屏不可见），高 110px | 顶部 314px（首屏完整可见），高 335px |
| 对比控件 | 全宽 label 块，卡片空白 75px | 16px 勾选角标，卡片空白 30px |

## 验证

- 浏览器回归（after）：107 项通过——1366×768（缩放 1/1.25）与 1568×1005，普通/最大化：弹窗在视口内、无横向溢出、
  验收摘要置顶、首屏可见结果图、按钮 ≥34px、主操作 ≥44px、底栏 ≤120px；反馈展开/收起保留草稿且不发请求、关闭有草稿时确认；
  更多操作/删除确认取消不删、确认后删除；880 宽窄窗口分区；键盘空格选择对比、并排对比、Escape 只关闭大图；
  无图任务显示缺失说明；退回调整写入服务；归档后底栏消失；无未捕获页面错误。
- 浏览器基线（before，导入提交 bba40b2）：同一脚本复现上表“修改前”数据（不断言）。
- `node scripts/verify-task-detail-modal.mjs`：37 项通过。隔离 `tsc --noEmit` 退出 0；MCP 诊断 0。
- 完整 PowerShell `npm run verify`：退出 0（日志 .tmp/arena-dispatch/detail2-verify.txt，末尾 A4Note verification passed）。
- 源码提交：23db5a6e691ce5c89d4eb8ee7a24f7ad35b69ced（8 个显式文件；生成的 src-tauri/gen/schemas 未纳入）。

截图（.tmp/detail-review-ui/{before,after}/）：evidence-1366x768-normal/max、evidence-1568x1005-normal/max、
feedback-open-1366x768、more-actions-open-1366x768、narrow-880x700-more-open、tab-任务要求/执行记录/完整历史、
compare-pair、no-images-1366x768、queued-footer-1366x768、archived-1366x768。关键图已上传任务附件。

## 边界与未验证

- 证据来自隔离 Chrome 中的生产构建组件与合成任务库，不是 Tauri 原生窗口或安装版；用户当前安装版不含 f376994b 与本改动。
- 深色主题、系统 DPI 与 1024 宽仅通过 880 宽窄窗口和 1.25 缩放间接覆盖，未逐一截图。
- 未改变任务阶段、权限与归档语义：归档/退回/删除仍走原有接口；无自动归档。
- 未合并 main、未推送、未安装发布、未重启现用服务；提交仅进入待检查，由用户验收。


## 第二轮（用户退回：检查框固定在弹窗底部遮挡效果展示）

用户反馈：结果截图下方的“检查效果”类操作框固定在弹窗上，遮挡了效果展示内容；要求把它放到界面内容的最下边，不固定在弹窗上。

### 改动（提交 72d15a1）

- `TaskBoard.tsx`：不再向 `TaskDetailDialog` 传 `footer`。“检查效果”说明、需要调整 / 效果满意归档、按需展开的反馈面板与收起的“更多操作”危险区，
  改为 `<section class="tb-detail-actions-section">`，渲染在滚动正文 `.tb-detail` 的最后（四个页签共用，随内容滚动）；已归档任务仍不渲染。
  反馈面板改为在按钮行下方展开（不再替换说明文字），展开时 `scrollIntoView({block:'nearest'})` 让面板完整进入可视区。
- `taskboard-dialog.css`：新增操作区分隔样式（上边距 32px、分隔线），移除弹窗专用固定底栏规则；不使用 sticky/fixed。
  `TaskDetailDialog` 组件本身保留可选 `footer` 插槽（无调用方传入时不渲染任何底栏）。
- `scripts/verify-task-detail-review-ui-browser.mjs`（138 项）：每个视口/缩放/最大化组合断言 无固定底栏（`.tb-detail-footer` 不存在、操作区 `position: static` 且位于 `.tb-dialog-body` 内）、
  操作区是正文最后一个节点且顶部 ≥ 当前页签内容底部、顶部滚动位置时不压住任何结果图；滚到末尾时归档按钮完整位于正文可视区且操作区位于全部证据卡片之下；
  四个页签逐一检查同样成立；反馈面板在按钮下方展开、展开后完整可见、回滚到顶部时结果图无任何覆盖；非 review 任务的“更多操作”同样在正文流内；归档后既无底栏也无操作区。
- `scripts/verify-task-detail-modal.mjs`（41 项）：新增源码级守卫——TaskBoard 不再传 footer、操作区位于最后一个内容 section 与 `</aside>` 之间、
  反馈面板在按钮之后渲染、操作区样式含分隔线且无 sticky/fixed。

### 前后对比（同一合成夹具，1366×768，未最大化）

| 指标 | 第一轮（被退回） | 第二轮 |
| --- | --- | --- |
| 操作区位置 | 弹窗固定底栏，高 69px；反馈展开后 270px，覆盖正文下部 | 正文流末尾，随内容滚动；顶部滚动位置时操作区在结果图之下（top 2606px vs 图底 650px） |
| 正文可视高度 | 弹窗高度 − 头部 − 页签 − 底栏 | 底栏归零，正文可视区相应增高约 69px |
| 反馈面板 | 底栏内替换说明文字展开，把按钮推到最底 | 在按钮行下方展开，自动滚入可视区，按钮位置不动 |
| 归档 / 需要调整按钮 | 176×44 / 44px | 不变（176×44 / 44px），滚到末尾完整可见 |
| 更多操作 → 删除 | 收起在底栏左侧 | 收起在操作区左侧，展开在正文流内；窄窗口（880）分行、与归档间距 ≥32px |

### 验证

- 浏览器回归（after）：138 项通过；截图 `.tmp/detail-review-ui/after/`：evidence-1366x768-normal/max、evidence-1568x1005-normal/max、
  actions-end-*（滚到末尾）、feedback-open-1366x768、feedback-open-scrolled-top-1366x768、more-actions-open-1366x768、narrow-880x700-more-open、
  tab-任务要求/执行记录/完整历史、compare-pair、no-images、queued-footer、archived。第一轮截图保留在 `.tmp/detail-review-ui/round1/`。
- `node scripts/verify-task-detail-modal.mjs`：41 项通过；`tsc --noEmit -p tsconfig.app.json` 退出 0。
- 完整 `npm run verify`（scripts/verify-all.mjs，含 Rust 测试）：退出码 0，输出 `A4Note verification passed`（日志 `.tmp/verify-logs/verify-round2.log`）。
- 未改变归档/退回/删除接口与语义；未合并 main、未推送、未安装发布、未重启现用服务。
