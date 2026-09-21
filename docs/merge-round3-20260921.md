# 集成 round3：540986ab 与 ab3806ec 已归档交付合并到 main

日期：2026-09-21；执行者：青岚（Arena / MCP 远程会话，worker）；任务：`8767e2a8-1bc2-498d-8b5c-de47ec8fb4fd`，需求版本 1。

## 连接与边界

通过 ShunCode Bridge MCP 连接本机（initialize/tools/list 确认 15 个工具），按 AGENTS.md 与 `apps/project-tasks/README.md` 运行 `doctor`，项目身份 `db83d583-436f-474c-9480-a42e4147b46a` 一致。独立 worker 会话原子领取（revision 1 → 2），不提权 dispatcher、不读取或输出管理凭据、不代替用户归档。

未推送远端、未打包、未发布、未重启 4319 服务、未安装任何版本。本轮只在自建 worktree 与 main 的现有 checkout 内操作，未触碰其他 Agent 的在途改动。

## main 写所有权核查

领取时 `main = 8bb915f`（`docs(tasks): record 41a28025 cherry-pick and 0.1.24 package`），即前一集成轮 0.1.24 的收尾提交；`git worktree list` 显示 main 仅由 `D:/WorkSpace/Aster-wt/main-archived-20260920` 持有且工作区干净，未发现并行写 main 的在途轮次。本轮不是接续他人未完成的集成，而是在其收尾后继续。

集成在新建的独立 worktree `.worktrees/round3-20260921`（分支 `integrate/round3-20260921`，基点 8bb915f）完成，验证通过后再对 main 做 fast-forward，全程未在主工作区脏树（`feat/capture-folder-tree-0.6.2`，446 项改动）上操作。

## bba40b2 去重判定

任务描述要求 bba40b2 与 round2 移植 baa018e 按 patch 去重。逐文件比对结论：

| 文件 | 判定 | 依据 |
| --- | --- | --- |
| `src/features/taskboard/TaskBoard.tsx` | 已在 main，跳过 | bba40b2 与 baa018e 的增删行完全一致（TaskReviewSummary 与 TaskAcceptancePanel 顺序调整） |
| `src/features/taskboard/taskboard-dialog.css` | 已在 main，跳过 | 两者 76 行新增 patch 内容逐行相同 |
| `src/features/taskboard/task-shell-sidebar.css` | 不携带 | 唯一差异是文件末尾一个空行，无语义 |

因此 bba40b2 的实质交付已由 round2 进入 main，本轮不重复引入。它在 `feature/task-detail-review-ui` 的历史链上，故最终仍满足 `merge-base --is-ancestor`。

## 合并方式与冲突处理

`540986ab`：commit 9508a88 先以 `cherry-pick -x` 引入（e71a0f8），干净无冲突。

`ab3806ec`：直接 cherry-pick 23db5a6 会与 main 已有的 baa018e 冲突，故改用真实 merge `feature/task-detail-review-ui`（合并基 4b4f57a），一次性带入 23db5a6、6f300bf、72d15a1、9ae46b3，共 11 处冲突集中在两个文件。

冲突解决原则：分支 72d15a1 的产品意图是把审核操作从固定弹窗 footer 移入可滚动正文，故采用分支的新结构；但 main 上有两块分支不知道的功能必须保留，重新宿主到新结构内：

- **交付合并状态**（来自 7f3debcf）：移入 `.tb-review-actions` 顶部，保留交付提交、main 合并状态、错误提示与"本地合并不等于远端推送或发布"说明。
- **交还离线任务**（来自 41a28025）：`.tb-release-stale` 整组移到"更多操作"之前，`releaseReason` / `releaseOpen` 状态、`releaseStaleTask()` 与全部相关 CSS 一并保留。
- 删除任务的回调补上 `setReleaseReason('')` / `setReleaseOpen(false)`，与分支对 feedback 的重置保持一致。

CSS 侧：同名选择器取分支的新值；分支新增的附件画廊、review 层级规则全部保留；仅丢弃已被新结构取代的 `.tb-detail-footer`、`.tb-user-actions` 与旧 `.tb-review-actions` 布局规则，`.tb-release-stale*` 10 处规则完整保留。

最终两个 merge commit：
- `5392ba5` — 带入 ab3806ec 四笔并解决冲突；
- `820f7ea` — merge `feature/pdf-text-annotation-inline`，使 9508a88 也成为 main 祖先（树内容与 5392ba5 完全一致，`git diff HEAD~1 HEAD` 为空，仅记录祖先关系）。

## 验收核验

全部 6 个目标 commit 在 main 上通过 `git merge-base --is-ancestor <commit> main` 核验：

```
9508a88 IN_MAIN   23db5a6 IN_MAIN   6f300bf IN_MAIN
72d15a1 IN_MAIN   9ae46b3 IN_MAIN   bba40b2 IN_MAIN
```

main：`8bb915f` → `820f7ea`（fast-forward，无额外提交）。

| 验证 | 结果 |
| --- | --- |
| `tsc -b --force` | 0 错误 |
| tsc 有效性自检 | 注入 `const __sanity: number = "x"` 被捕获为 TS2322，恢复后 0 错误，确认非缓存跳过 |
| verify-task-detail-modal | 41 断言通过 |
| verify-task-offline-ui | 5 项浏览器检查通过（覆盖交还离线任务） |
| verify-task-merge-ui | 6 项浏览器检查通过（覆盖交付合并状态） |
| verify-task-acceptance | 109 断言通过 |
| verify-task-stage-views | 74 断言通过，隔离 TS 诊断 0 |
| verify-pdf-text-annotation | 28 项通过 |
| verify-architecture-boundaries | 通过 |

### 既有失败（非本轮回归）

`verify-taskboard-usability` 失败：第 275 行断言期望阶段标签为 `['总览','积压','任务队列','进行中','待验收','已归档']`，实际 UI 为 5 个标签 `总览 / 任务队列 / 正在进行 / 待检查效果 / 已归档`。

已在 8bb915f 基线单独建 detached worktree 复跑，**基线以完全相同的断言失败**，确认是先于本轮存在的过期测试（阶段模型改版后未同步），不是本次合并引入。本轮未修改该脚本，也未为通过而放宽断言；建议由阶段视图的负责人单独处理。

## 交付限制

这是源码集成交付，等待用户检查，不是验收通过证明。浏览器夹具（verify-*-browser）结果不等同于安装版原生验收；本轮未做真实 Windows 原生界面验证、未生成截图附件。未推远端、未打包 0.1.25、未安装，现用桌面不会因本次合并自动更新。

集成分支 `integrate/round3-20260921` 与其 worktree 保留在 `.worktrees/round3-20260921`，供复核；确认后可由用户移除。若需回退，`git reset --hard 8bb915f` 即可还原 main，不影响两个源分支。
