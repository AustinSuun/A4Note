# Aster AI 对话 CLI 设计方案

## 目标

为 Aster 建立一个独立的 AI 对话场景，让用户可以在应用内直接使用本机已经安装和登录的 AI CLI 工具。界面和体验参考 Paseo 中对我们有用的部分：Provider 选择、模型选择、权限模式选择、长期会话、流式输出、停止/继续、以及清晰的不可用状态。

这不是复制 Paseo 的工作区或代码项目管理模型。Aster 的 AI 对话服务对象是本地知识库，包括文献、PDF、笔记、标注、标签和关系。

## 第一版范围

第一版只实现独立的 `AI 对话` 场景。阅读场景右侧栏里的 AI 对话暂时不改，等独立场景稳定后再复用同一套 Provider 和会话能力。

第一版只支持以下 Provider：

- Claude
- Codex
- Copilot
- OpenCode
- Pi

本版本不做自定义 Provider，不做 Provider 市场，不接入其它 API 服务，也不扩展其它 Provider 家族。某个 Provider 如果本机没有安装 CLI、没有登录、或当前平台不支持，就在界面中显示为“未配置”或“错误”，但不影响其它 Provider 使用。

## 产品行为

AI 对话场景包含：

- 左侧栏：会话列表、Provider 状态和当前上下文摘要。
- 主区域：消息流，支持 assistant 回复流式展示。
- 底部输入框：消息输入、发送/停止、附件入口、`@` 上下文入口、Provider 选择、模型选择、权限模式选择和上下文控制。
- 明确的空状态、加载状态、运行状态、已停止状态、失败状态和 Provider 不可用状态。

核心流程：

1. 用户打开 AI 对话场景。
2. Aster 检测本机支持的 CLI Provider。
3. 用户选择 Provider、模型、权限模式，以及可选的固定上下文。
4. 用户发送问题。
5. Aster 根据自动检索结果和用户固定的 `@` 引用构造知识库上下文。
6. Tauri 后端启动或复用对应 Provider 的本地 CLI 会话。
7. CLI 输出流式进入消息区域。
8. 对话消息和上下文引用保存到本地资料库。

## 知识库上下文

上下文采用混合模式：

- 默认支持自动检索。Aster 会从当前知识库中检索相关文献、笔记、标注、标签和关系。
- 支持用户通过 `@paper`、`@note`、`@annotation`、`@tag` 固定具体上下文。
- 最终传给 CLI 的 prompt 由结构化上下文块和用户问题组成。

第一版使用现有内存中的文献数据和关系 helper，不要求新增向量索引。如果后续自动检索质量不够，可以再加入全文检索或 embedding，但不改变 Provider 接口。

## Provider 模型

每个 Provider 使用独立 adapter：

- `codexAdapter`
- `claudeAdapter`
- `copilotAdapter`
- `opencodeAdapter`
- `piAdapter`

每个 adapter 负责：

- 检测 CLI 是否存在。
- 检测是否可运行、是否已登录。
- 提供支持的模型列表。
- 映射权限模式。
- 启动会话。
- 发送消息。
- 解析流式输出。
- 停止和清理进程。
- 统一错误信息。

React 组件只依赖统一接口，不直接知道各 Provider 的命令参数和输出格式。

## 权限模式

界面提供三个通用权限模式：

- `Default permissions`：使用 Provider 默认审批和沙箱策略。
- `Auto-review`：保守模式，适合总结、检查、问答和 review 类任务。
- `Full access`：用户明确选择后才启用的高权限模式。

各 Provider adapter 负责把这三个模式映射为自己的 CLI 参数。对 Codex 来说，主要映射到 `--ask-for-approval`、`--sandbox` 和相关配置覆盖。其它 Provider 如果有对应权限参数，就做相应映射；如果不支持某个模式，界面中标记为不可用。

Aster 自有数据写入必须受控。如果 AI 回复提出创建笔记、标签、关系或其它知识库变更，Aster 需要先展示变更内容并让用户确认，再写入 SQLite。CLI Provider 不能直接修改 Aster 数据库。

## 长期会话

目标体验接近 Paseo 的本地 CLI 对话感：用户不应该感觉 Aster 只是做了一次性 API 调用。一个会话可以处于运行中、流式输出中、已停止、失败或已关闭状态。

实现边界：

- Tauri 后端负责进程生命周期。
- 前端负责 UI 状态，并通过 Tauri 命令发送操作。
- 一个 CLI 会话绑定到一个 Aster AI thread。
- 停止生成时，需要安全中断或终止底层 CLI 进程。
- 如果某个 Provider 不支持真正的交互式持续会话，它的 adapter 可以用“带历史和上下文重新启动一次 CLI 调用”的方式模拟继续对话。

这样前端始终面对统一的长期会话模型，同时允许不同 Provider 用自己的方式实现。

## 数据模型

继续复用现有表：

- `ai_threads`
- `ai_messages`

实现时可以按需增加元数据字段，让 thread 能记住：

- Provider id。
- Model id。
- Permission mode。
- 上下文引用。
- 会话状态。

如果需要改 schema，必须是增量迁移。已有 AI 对话记录必须继续可加载。

## UI 边界

`src/features/ai` 负责独立 AI 对话场景：

- 对话页面外壳。
- 会话列表。
- 消息流。
- 输入框。
- Provider picker。
- Model picker。
- Permission picker。
- Context picker。
- 会话 hook 和状态管理。

`src/core` 负责共享 AI 类型和 Provider 注册类型。

`src/platform` 负责封装前端调用 Tauri 的 API。

`src-tauri` 负责本地 CLI 执行和进程管理。

阅读器侧边栏的 `ReaderChatPanel` 第一版保持现状。等独立 AI 对话场景稳定后，它可以复用同一套 Provider 和 session primitive。

## 错误处理

Provider 状态必须明确：

- 已安装且可用。
- 已安装但未登录。
- CLI 缺失。
- 当前平台不支持。
- 启动失败。
- 运行中。
- 用户停止。
- 异常退出。

错误显示在 AI 对话场景内，不能导致整个应用崩溃。即使 Provider 运行失败，Aster 也应该保留用户已发送的消息。

## 测试和验证

实现完成后的最低验证：

- `npm run build`
- `npm run test:architecture`
- 能覆盖时，为 Provider 检测和进程命令构造增加 Tauri/Rust 测试。
- 至少用 Codex CLI 做一次桌面端手动验证。

如果后续任务改到阅读器侧边栏 AI，再额外运行 reader 相关测试。

## 非目标

本版本不做：

- 替换阅读器侧边栏 AI 对话。
- Provider 市场。
- 自定义 Provider 编写界面。
- 云端 AI API 接入。
- embedding 或向量检索。
- 未经用户确认直接写 SQLite。
- Paseo 的完整 workspace 管理、Git workspace 标签页或多 workspace 历史。

## 实现说明

当前开发机能检测到 Codex 和 Claude。Copilot、OpenCode 和 Pi 可能没有安装。应用仍然应该把这几个 Provider 作为第一版固定入口展示；如果找不到对应 binary，就显示不可用状态。

每个 Provider adapter 的实际行为必须基于对应 CLI 验证后再标记为可用。如果某个 CLI 存在但流式协议不稳定，该 Provider 可以先使用“模拟继续对话”的 fallback，同时仍然出现在统一 UI 中。
