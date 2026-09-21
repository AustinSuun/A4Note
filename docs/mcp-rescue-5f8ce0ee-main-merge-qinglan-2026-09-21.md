# 补合 5f8ce0ee 交付到 main（be3b361d 集成阻塞的处理）

日期：2026-09-21；执行者：青岚（Arena / MCP，worker）；main：`5923514` → `3ce91ee`。

## 背景：自动合并门确实触发过，并且拒绝了

用户于 `2026-09-21T00:43:50Z` 对 `be3b361d` 人工验收通过，任务服务的交付合并门随即运行并**拒绝合并**：

```
integration.status : blocked
integration.error  : 缺少明确交付信息，请退回补齐；不得把归档等同合并
delivery.kind      : unknown
delivery.reason    : 旧交付未声明代码范围，不推断已合并
```

原因见 `lib/task-delivery.mjs`：`kind:'code'` 的交付必须绑定 `commit`、`baseCommit`、`sourceRef` 并通过一致性校验；`be3b361d` 提交时未提供 `--delivery-json`，故被判定为 `unknown`，门按设计拒绝推断。卡因此停在 `review`，进度写明"验收通过，但代码集成阻塞；查看合并状态并重试"。

这与前一份对账的结论一致：门的代码在 main，但历史卡从未提供交付清单，所以合并始终靠人工。本次是门第一次真正对一张卡运行并给出 `blocked`。

## 本轮所做的合并

抢救分支 `rescue/5f8ce0ee-gateway-exit-lifecycle`（`9d0f8ab` + `b81990f`）基于 `8bb915f`，而 main 已推进到 `5923514`（round3）。在独立 worktree `.worktrees/rescue-merge-20260921`（分支 `integrate/rescue-5f8ce0ee`，基点 5923514）执行合并：

- **零冲突**自动合并，23 文件、+938/−17。
- `TaskBoard.tsx` 仅新增 2 行（`TaskServiceControls` 的 import 与挂载）。
- 已逐项核验 round3 成果未被破坏：`tb-release-stale`(7)、`releaseStaleTask`(2)、`交付合并状态`(1)、`tb-detail-actions-section`(1)、`feedbackOpen`(5)、`tb-more-actions`(1) 均在。

合并提交 `3ce91ee`，随后对 main 做 fast-forward。

### 缺口关闭核验

| 文件 | 合并前 | 合并后 |
| --- | --- | --- |
| `apps/project-tasks/gateway-lifecycle.mjs` | ABSENT | **IN_MAIN** |
| `src/platform/projectTasksLifecycle.ts` | ABSENT | **IN_MAIN** |
| `src/features/taskboard/TaskServiceControls.tsx` | ABSENT | **IN_MAIN** |

`git merge-base --is-ancestor 9d0f8ab main` 通过。

## 验证

| 验证 | 结果 |
| --- | --- |
| `tsc -b --force` | 0 错误 |
| `cargo check` | Finished，无错误（仅既有 dead_code 警告；本次含 `project_tasks.rs` +191 行、`lib.rs`、capabilities 变更） |
| `gateway-lifecycle.test.mjs` | 6/6 通过 |
| `npm run test:project-tasks` | 0 fail，1 skipped |
| verify-project-task-launcher | 通过 |
| verify-architecture-boundaries | 通过 |
| verify-task-detail-modal | 41 断言通过 |
| verify-task-offline-ui | 5 项通过 |
| verify-task-merge-ui | 6 项通过 |
| verify-task-acceptance | 109 断言通过 |
| verify-pdf-text-annotation | 28 项通过 |

首次 `cargo check` 因新 worktree 缺 `resources/native-host/a4note-native-host.exe` 构建产物而失败，与代码无关；运行 `scripts/prepare-native-host.mjs` 生成后通过。

## 未做与边界

- **未代替原执行者重新提交 `be3b361d`**。该卡处于 `review`，而服务的 `takeover` 仅允许接管 `in_progress` 的任务（`lib/store.mjs`：`仅可接管其他负责人的进行中任务`），`progress` 亦要求 `owner && in_progress`。代提交的路径被服务正确封死，本会话不绕过。
- 卡的 `integration.status` 仍为 `blocked`，`delivery.kind` 仍为 `unknown`。**代码已在 main，但看板记录未更新**——两者需由用户或原执行者对齐。
- 未推送远端、未打包、未安装、未重启 4319、未自行归档。

## 建议

1. `be3b361d` 的 `blocked` 状态需要用户在看板处理：可退回该卡让原执行者带 `--delivery-json` 重新提交，或由用户直接归档并接受"代码已由本轮人工合并"这一事实。
2. 若希望今后归档即自动合并，需要让 `--delivery-json` 成为提交的默认产物（当前 CLI 支持但不强制，执行者不传就会退化为 `unknown`）。这适合单独发一张卡。
3. 主工作区脏树仍有大量未跟踪文件；`9d0f8ab` 只提取了 5f8ce0ee 范围，清理前仍需确认其余在途改动的归属。
