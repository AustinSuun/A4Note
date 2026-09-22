# 上下文快捷键任务接手记录

更新时间：2026-09-22T08:18:46+08:00

## 任务与权限

- 任务：`9230f8ce-beef-4157-8771-014c4aee48c4`，搭建上下文快捷键系统。
- 用户明确要求接手指定进行中任务；执行代号：星序（worker）。
- 原负责人青砚最后心跳 `2026-09-21T13:04:22.036Z`，服务判定 offline。
- 已使用用户授权 takeover：revision 5 → 6；重读需求、验收、附件和交接后 acknowledge：revision 7、claimed_spec 1。
- 原卡没有 handoff 对象，没有附件；已读历史 progress，不能把核心完成等同于整卡完成。
- 私有会话保存在用户主目录，凭据不入库、不共享旧会话。

## 工作区与继承基线

- 主工作区：`D:/WorkSpace/Aster`，读取时 main 为 `311049b`。
- 已跟踪文件干净；现有未跟踪 PDF、`docs/pdf_test/`、截图保留，不认领或清理。
- 原工作树 `.worktrees/shortcuts-qingyan` 干净，原分支 `feat/context-shortcuts-qingyan`、提交 `8c847d3` 保持原样。
- 新工作树 `.worktrees/shortcuts-xingxu`，分支 `feat/context-shortcuts-xingxu`，基于 main 新建。
- cherry-pick 原核心为 `e17fc7f`；仅继承 `src/core/shortcuts.ts` 和 `scripts/verify-shortcuts.mjs`，无冲突。
- 其他 Reader/橡皮擦任务不在本次授权范围内；不重启共享服务、不结束其他 Agent 进程。

## 已有实现与剩余差距

已有：结构化 keyboard/mouse 绑定、作用域优先级、覆盖配置读写、冲突查找、上下文保护、单项/作用域重置和注册表。尚未有实际顶层 dispatcher 或配置界面。

接线前需要复核的代码边界（不是已修复结论）：

- `src/core/shortcuts.ts` 的 `eventTargetIsEditable` 直接引用 DOM 类，应移动到浏览器适配层，维持 core 不依赖浏览器 API 的项目边界。
- 配置解析当前对修饰键类型验证宽松；逻辑 key / 物理 code 交叉冲突、特殊键的 ARIA 显示、默认与覆盖冲突应补测试。
- 现有 30 项测试没有真实 DOM、Control 生命周期、焦点或执行回调覆盖，不代表 UI 验收。
- 阅读器笔记工作台已在 main 提供命令清单。参考 `docs/mcp-reader-note-workbench-arena-2026-09-21.md` 与 `src/features/reader/useReaderWritingShortcuts.ts`，接管监听时不得保留双重执行。

## 后续实施顺序

1. 完善纯模型边界、绑定验证与冲突事务；提供稳定出口及测试命令。
2. 在共享浏览器适配层实现唯一 dispatcher：实时 active scene、焦点、IME、AltGraph、模态和录制保护；仅真正执行才 preventDefault。
3. 实现约 150ms Control 提示生命周期、就地 anchor kbd 与无锚点右侧分组面板；处理 keyup/blur/visibility/unmount 和 reduced-motion。
4. 实现共享录制/替换冲突/清除/重置组件；全局 Settings 与 Reader 各用相同逻辑，配置版本化持久化。
5. 迁移侧栏可见场景、命令面板及 Reader 工具/搜索/撤销/选择/写作/缩放，删除被替代硬编码监听；明确 PDF 与全局 UI zoom 的不同绑定。
6. 补纯逻辑与真实 DOM 测试；在隔离 dev:live Windows/Tauri 实例取连续截图和重启持久化证据。硬件未暴露侧键时如实说明，不假称支持所有设备。
7. 完整验证后重新核对 main 与并行文件归属，串行合并本任务，核验包含关系，再按最新 revision submit code delivery；不自行归档或发布。

## 本轮验证

命令在新工作树执行，桥命令 `cmd_4ce02a442b38966c08f9076e35190759727514a56bba81b6` 退出 0：

- `node scripts/verify-shortcuts.mjs`：30 checks 通过。
- `npm run test:ui-state`：通过。
- `node scripts/verify-reader-priority-fixes.mjs`：60 项通过，模拟边界，非 desktop E2E。
- `npm run test:reader`：通过。
- `npm run build`：TypeScript 与 Vite 通过；有分包大小、静态/动态混合 import 和插件耗时警告。
- `get_diagnostics`：新工作树 `src/core/shortcuts.ts` 当前 0 条，不代表全项目已验证。

本轮只完成接管、继承与基线验证。剩余功能、完整 verify、真实桌面截图、main 合并和任务 submit 均未完成。未安装、打包、推送、发布或写真实资料库。
