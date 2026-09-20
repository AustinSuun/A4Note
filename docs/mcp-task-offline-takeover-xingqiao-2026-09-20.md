# 离线任务接管交付（星桥执行，2026-09-20）

任务：f2528fae-2f98-42da-a4e3-8abf616ad9bb。
分支：feature/task-offline-takeover；工作区：.worktrees/task-offline-takeover；基线：本地main 4b4f57a。

## 已实现

- 原子接管：worker声明用户授权、记录说明并核验工作区隔离后，可接管超过120秒无心跳的进行中任务，无需旧Agent release。
- 仅离线可接管；在线、未知/无效/未来心跳、无用户授权、未核验工作区、过期revision、非worker均拒绝。并发仅一人成功。
- 保留任务ID、要求、附件、历史及结果；更换owner后重置claimed_spec，新Agent必须重新读取并acknowledge。旧会话恢复心跳不能夺回任务更新/交还/提交权限。
- 结构化handoff含已完成、剩余、阻塞、下一步、分支/worktree/commit、未提交变更、资源和验证；记录作者/时间。缺失明确返回null；不要求失联Agent补交。
- CLI takeover/handoff、MCP update_task同步支持；进行中界面展示服务端presence与最后心跳，时间线保留授权说明与交接原文。
- 用户授权来源如实记录为worker转述，不宣称服务已独立认证聊天；任务权限也不能停止旧进程写文件。

## 文件范围

apps/project-tasks/lib/store.mjs、cli.mjs、mcp.mjs、README.md、test/offline-takeover.test.mjs；src/platform/projectTasks.ts；src/features/taskboard/TaskStageViews.tsx、TaskDetailSections.tsx；scripts/verify-task-offline-ui.mjs。

## 验证

- 新增专项4/4通过：服务端权限/状态、真实HTTP竞领、CLI接管、MCP结构化交接及跨项目隔离。
- 任务服务全套75项：74通过、1平台文件符号链接权限跳过、0失败。日志：.tmp/arena-dispatch/all-task-tests.txt（中央工作区）。
- 独立Chrome生产组件夹具5检查通过：离线/负责人/写入风险文案、查看记录、展开交接；截图与JSON位于本工作区.tmp/task-offline-ui/。
- 完整PowerShell npm run verify退出0（cmd_d6eac4265ec6a7a1a83a60d91057019f32fdad09bd8fa72b），含TypeScript、Vite生产构建、架构、状态与Rust等验证；MCP诊断0项错误。
- 中央状态校验初次因scope超过16失败，已将本任务认领并入既有相关scope，不删除其他Agent记录；复测通过。

## 交付边界

所有产品修改只在独立分支，不覆盖共享目录已有未提交takeover/task-delivery工作，不修改青岚的共享TaskDetailDialog或样式。没有升级/重启现用4319服务、迁移真库、安装或推送。当前已运行服务不因此自动具备新能力；需审阅并集成本分支后，另行授权部署。
尚未做安装版/Tauri原生验收；截图是独立Chrome组件，不是用户真实窗口。用户负责验收，不自行归档。第二项7f3debcf尚未领取，按顺序执行。
