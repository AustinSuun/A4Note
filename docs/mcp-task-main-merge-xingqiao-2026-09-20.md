# 验收后main合并机制（星桥执行，2026-09-20）

任务：7f3debcf-b5ad-41fd-b535-b71f83a04ead。
分支：feature/task-acceptance-main-merge；独立工作区：.worktrees/task-main-merge；依赖上一任务提交b8bbe5851234a041a82a33976f179e7069895ce0。

## 核查与既有成果

当前现用任务服务仍为旧协议；未重启、迁移真库或追溯合并历史卡片。本地main基线为4b4f57a，不等于远端已更新。
已阅读并复用现有只读审计与集成记录：docs/mcp-archived-task-merge-audit-2026-09-20.md、docs/mcp-archived-local-main-integration-2026-09-20.md。前者确认17个归档任务不能等同代码全部入main；后者记录14项归档范围可分离成果进入本地main，3项PDF（2a6ec117/fdcf97df/a14eca65）因共享在途依赖暂缓。此处不重新宣称原生验收或远端包含关系已验证，不回填历史卡片。
共享工作区已有未提交task-delivery原型，但会猜测共享HEAD且先归档后合并。本分支从已审阅main发展独立实现，不覆盖该原型；集成时不能简单复制两个不同版本的Store。新模块同名但使用显式清单和事件存储，避免新增数据库列迁移。已在独立tauri.conf.json补齐打包映射，不覆盖7281de4c在共享树中的资源修复。

## 实现

- 显式交付：仓库、完整SHA、源分支、基线SHA、实际变化文件列表、验证说明，绑定delivery_revision/spec_revision；纯无代码任务另作说明。
- 人工和自动验收统一合并闸门。失败保留review及已验收事实，不显示已归档。用户可以查看原因后重试。
- 公共Git目录排他锁；隔离worktree合并；验证命令仅由服务配置，不允许worker负载注入；验证后拒绝源码被改、main变化、脏main。干净已检出的main以ff-only同步文件，未检出main使用旧SHA比较更新。
- 记录合并前/后SHA、sourceCommit、验证输出、失败/冲突路径、用户/验收者、时间。交付已在main时对账，数据库回写失败不会重复合并；不推送远端。
- CLI --delivery-json、MCP delivery对象、HTTP/Store、阶段列表及详情重试说明、资源映射同步。

## 验证与边界

初轮7项Git/Store专项6通过1失败：测试仓库继承Windows autocrlf使恢复夹具仍呈dirty；已在临时仓库显式设置core.autocrlf=false，生产保护未放宽。随后全部7项通过，服务全套82项81通过、1平台文件符号链接权限跳过。又补真实CLI/HTTP验收与分支移动用例，现已接入package.json固定回归入口：84项83通过、1平台权限跳过、0失败。
独立Chrome生产组件夹具6检查通过，显示合并失败、SHA、未推送、错误及查看历史；截图在本工作区.tmp/task-merge-ui/merge-blocked.png。不是安装版或完整原生窗口验收。
完整PowerShell verify正在运行，完成后补最终结果。

部署前必须由用户配置TASKS_GIT_VERIFY_ARGV可信验证命令；缺配置会明确阻止合并。这次不擅自升级现用服务、推送、安装、批量合并历史卡或操作其他用户窗口。当前实现验证为同步串行（最多10分钟），会阻塞该服务请求；大项目应低干扰时段运行。崩溃锁不会自动抢占，需要用户确认旧PID停止后清理再重试。这是安全边界，不伪称已有后台异步队列。
