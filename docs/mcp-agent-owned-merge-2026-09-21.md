# Agent负责合并；归档仅验收

## 授权与范围

用户明确确认：独立开发验证后由执行Agent自动合并本任务到本地main，再提交待检查；归档仅确认验收。不得自动推送、打包、安装、发布或重启现有服务。本次独立分支fix/agent-owned-merge，基线59235142509588029793c042127ba525b508113d；没有修改共享脏工作区或其他Agent工作树。

## 实现

- code delivery提交必须具备完整SHA、实际变更清单、验证描述、匹配分支/基线，并只读确认交付SHA已被本地main包含，否则拒绝submit。
- 删除归档中的候选工作树、验证命令执行、merge、update-ref及集成锁写入。人工/自动归档共用只读核对；Git不可用、旧交付未记录或未合并仍允许验收，但记录failed/blocked/not_configured，不伪报已合并。
- AGENTS、执行者复制提示、MCP instructions、onboarding及README同步同一顺序和失败停机边界。
- UI不再提示再次归档可重试合并；提示执行Agent负责处理。
- 保留旧交付兼容性；未声明delivery的历史/旧客户端不会被误当作已合并代码交付。新版执行者应显式声明code或none。

## 验证

- 定向交付、验收集成、服务生命周期：8/8通过。
- node --test apps/project-tasks/test/*.test.mjs：81项，80通过、1跳过、0失败；包括自动验收、HTTP授权和CLI/MCP生命周期。
- 新回归：未合并submit被拒；人工归档不改refs、不执行配置验证器；保留脏main与未跟踪哨兵；历史未合并交付归档只记录阻塞；Git不可用不虚报成功；交付边界检查和执行者不能归档。
- npm ci、npm run build、npm run test:architecture通过；taskboard诊断0项。
- 本次不涉及Rust变更；没有声称已完成原生窗口或安装版端到端验证。构建保留现有chunk大小与动态导入警告。

## 生效边界

源码合并不等于已安装服务更新。D:/A4 Note的现有安装服务没有替换或重启；不能据本次源码测试宣称运行中的旧服务已采用新行为。当前环境隔离任务56a57eef仍保持其原有未完成状态，本次没有把该任务伪报完成。

## 合并阻塞

最终检查main仍为59235142509588029793c042127ba525b508113d，但存在其他Agent的未跟踪文件 `docs/mcp-archived-main-reconciliation-qinglan-2026-09-21.md`。遵守脏main时停止：本次只提交独立分支，不清理、不代提交该文件，不移动main。待该工作区干净后重新检查最新main及必要回归再合并。

补充检查：验收回归109断言、编辑冲突14断言、项目启动器打包依赖、agent-protocol、agent-status及diff --check均通过。

## 本轮继续复核

- main在复核期间从3ce91ee推进到34738d6c45eb2c50daad82bdc8e51fa0dd2d7f69，末次读取前后SHA一致。
- df9992cc71e9ae1f5c8d8a73ee2e7e0bcfd51592仍未被main包含（merge-base --is-ancestor退出1）。
- main仍有他人的未跟踪报告docs/mcp-archived-main-reconciliation-qinglan-2026-09-21.md，不擅自清理或提交。
- merge-tree预演退出1，报告plans/PROJECT_STATUS.json内容冲突；README、AGENT_STATUS和TaskBoard可文本自动合并，但不等于语义回归通过。预演未更新分支引用、索引或工作区。
- 本轮没有实际合并，也未在合并结果上执行测试；上文测试成绩只适用于原任务分支。需先由文件负责人处理main未跟踪报告，再保留双方状态记录处理冲突并重跑相关验证，才能合并。
- 未安装、重启、推送、发布或修改任务验收状态。
