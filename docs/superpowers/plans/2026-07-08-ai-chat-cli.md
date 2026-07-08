# AI 对话 CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Aster 独立 AI 对话场景中接入本机 Claude、Codex、Copilot、OpenCode、Pi CLI，并让它们围绕本地知识库进行长期对话。

**Architecture:** 前端在 `src/features/ai` 中提供独立对话 UI、会话状态、Provider/模型/权限/上下文选择；`src/core` 定义 Provider、模型、权限和上下文类型；`src/platform/nativeApi.ts` 封装 Tauri 命令；`src-tauri/src/ai_cli.rs` 负责 CLI 检测、命令构造、进程生命周期、事件输出和会话停止。知识库上下文先使用现有文献、笔记、标注、标签和关系数据做关键词检索与 `@` 固定引用，不引入向量索引。

**Tech Stack:** React, TypeScript, Tauri v2, Rust, SQLite, Node verification scripts, existing Aster core/feature/module boundaries.

---

## 文件结构

- Create: `scripts/verify-ai-cli.mjs`
  - 验证 AI CLI 关键文件、类型、Provider 列表、Tauri 命令和 UI 组件是否落地。
- Create: `scripts/verify-ai-context.mjs`
  - 直接验证知识库上下文检索和 prompt 构造函数。
- Modify: `package.json`
  - 增加 `test:ai-cli` 和 `test:ai-context` 脚本。
- Modify: `scripts/verify-all.mjs`
  - 把 AI CLI 验证纳入总验证。
- Modify: `src/core/types.ts`
  - 增加 CLI Provider、模型、权限、上下文引用、运行状态和 Tauri DTO 类型。
- Modify: `src/core/asterCore.ts`
  - 移除旧的 `local-context-assistant`、`codex-cli`、`claude-code-cli` 注册，改为只注册固定的五个 CLI Provider：Claude、Codex、Copilot、OpenCode、Pi。
- Modify: `src/features/settings/index.tsx`
  - 把设置页默认 AI Provider 改为 `codex`，避免继续指向被移除的旧 Provider。
- Create: `src/features/ai/aiContext.ts`
  - 负责自动检索、固定上下文合并、历史对话压缩和 prompt 构造。
- Create: `src/features/ai/AiProviderPicker.tsx`
  - Provider 列表与可用状态选择控件。
- Create: `src/features/ai/AiModelPicker.tsx`
  - Provider 模型选择控件。
- Create: `src/features/ai/AiPermissionPicker.tsx`
  - `Default permissions`、`Auto-review`、`Full access` 选择控件。
- Create: `src/features/ai/AiContextPicker.tsx`
  - `@paper`、`@note`、`@annotation`、`@tag` 固定上下文选择控件。
- Create: `src/features/ai/AiMessageList.tsx`
  - 消息流和 streaming 状态展示。
- Create: `src/features/ai/AiComposer.tsx`
  - 底部输入框、附件入口、发送/停止按钮和工具条。
- Modify: `src/features/ai/AIChatScene.tsx`
  - 从当前简单文献绑定对话重做为独立 AI 对话工作区。
- Modify: `src/features/ai/useChatThreads.ts`
  - 扩展为本地 CLI 会话状态管理和 Tauri 事件订阅；后续消息通过完整历史 prompt 重启一次性 CLI 进程。
- Modify: `src/features/ai/index.ts`
  - 导出新的组件、上下文 helper 和 hook 类型。
- Modify: `src/platform/nativeApi.ts`
  - 增加 AI CLI Provider 检测、启动、发送、停止、关闭和事件 DTO wrapper。
- Create: `src-tauri/src/ai_cli.rs`
  - 本地 CLI adapter、Provider 检测、命令构造、进程启动、流式读取、停止和测试。
- Modify: `src-tauri/src/lib.rs`
  - 注册 AI CLI Tauri commands，并把 session manager 注入 Tauri state。
- Modify: `src-tauri/schema.sql`
  - 增量增加 `ai_threads` 元数据字段。
- Modify: `src/ui/styles/components.css`
  - 增加 AI 对话页、picker、消息流、composer 和 provider 状态样式。
- Modify: `src/ui/zh.ts`
  - 增加中文文案。

---

### Task 1: 增加 AI CLI 验证脚本

**Files:**
- Create: `scripts/verify-ai-cli.mjs`
- Create: `scripts/verify-ai-context.mjs`
- Modify: `package.json`
- Modify: `scripts/verify-all.mjs`

- [ ] **Step 1: 创建 AI CLI 结构验证脚本**

Create `scripts/verify-ai-cli.mjs`:

```js
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'src/features/ai/AiProviderPicker.tsx',
  'src/features/ai/AiModelPicker.tsx',
  'src/features/ai/AiPermissionPicker.tsx',
  'src/features/ai/AiContextPicker.tsx',
  'src/features/ai/AiMessageList.tsx',
  'src/features/ai/AiComposer.tsx',
  'src/features/ai/aiContext.ts',
  'src-tauri/src/ai_cli.rs',
];

for (const file of requiredFiles) {
  assert.equal(existsSync(file), true, `Missing file: ${file}`);
}

const types = readFileSync('src/core/types.ts', 'utf8');
for (const text of [
  "export type AiCliProviderId = 'claude' | 'codex' | 'copilot' | 'opencode' | 'pi'",
  "export type AiPermissionMode = 'default' | 'autoReview' | 'fullAccess'",
  'export interface AiCliProviderStatus',
  'export interface AiCliContextReference',
]) {
  assert.ok(types.includes(text), `Missing AI CLI type: ${text}`);
}

const core = readFileSync('src/core/asterCore.ts', 'utf8');
for (const provider of ['claude', 'codex', 'copilot', 'opencode', 'pi']) {
  assert.ok(core.includes(`id: '${provider}'`), `Provider not registered: ${provider}`);
}

const nativeApi = readFileSync('src/platform/nativeApi.ts', 'utf8');
for (const fn of ['listAiCliProviders', 'startAiCliSession', 'sendAiCliMessage', 'stopAiCliSession', 'closeAiCliSession']) {
  assert.ok(nativeApi.includes(`function ${fn}`) || nativeApi.includes(`async function ${fn}`), `Missing native API wrapper: ${fn}`);
}

const tauri = readFileSync('src-tauri/src/ai_cli.rs', 'utf8');
for (const command of ['list_ai_cli_providers', 'start_ai_cli_session', 'send_ai_cli_message', 'stop_ai_cli_session', 'close_ai_cli_session']) {
  assert.ok(tauri.includes(command), `Missing Tauri command: ${command}`);
}

const scene = readFileSync('src/features/ai/AIChatScene.tsx', 'utf8');
for (const component of ['AiProviderPicker', 'AiModelPicker', 'AiPermissionPicker', 'AiContextPicker', 'AiMessageList', 'AiComposer']) {
  assert.ok(scene.includes(component), `AIChatScene does not render ${component}`);
}

console.log('AI CLI structure verification passed');
```

- [ ] **Step 2: 创建 AI 上下文行为验证脚本**

Create `scripts/verify-ai-context.mjs`:

```js
import assert from 'node:assert/strict';

const context = await import('../src/features/ai/aiContext.ts');

const papers = [
  {
    paperId: 'paper-transformer',
    title: 'Attention Is All You Need',
    authors: 'Vaswani et al.',
    year: 2017,
    venue: 'NeurIPS',
    doi: '',
    folderId: 'library',
    sourceFileId: 'file-transformer-source',
    sourcePdf: '',
    translatedFileIds: [],
    translatedPdfs: [],
    tags: ['Transformer', 'attention'],
    notes: [{ id: 'note-transformer', paperId: 'paper-transformer', title: '阅读笔记', content: 'multi-head attention and positional encoding', format: 'markdown' }],
    annotations: [{ id: 'ann-transformer', paperId: 'paper-transformer', fileId: 'file-transformer-source', page: 1, type: 'highlight', quote: 'Self-attention', comment: '核心机制', color: 'yellow', positionJson: {} }],
    aiThreads: [],
    metadataSource: 'seed',
  },
  {
    paperId: 'paper-rag',
    title: 'Retrieval-Augmented Generation',
    authors: 'Lewis et al.',
    year: 2020,
    venue: 'NeurIPS',
    doi: '',
    folderId: 'library',
    sourceFileId: 'file-rag-source',
    sourcePdf: '',
    translatedFileIds: [],
    translatedPdfs: [],
    tags: ['RAG'],
    notes: [],
    annotations: [],
    aiThreads: [],
    metadataSource: 'seed',
  },
];

const automatic = context.searchAiKnowledgeContext({
  papers,
  query: 'attention mechanism',
  fixedReferences: [],
  limit: 4,
});
assert.equal(automatic.some((item) => item.kind === 'paper' && item.id === 'paper-transformer'), true);
assert.equal(automatic.some((item) => item.kind === 'note' && item.id === 'note-transformer'), true);

const prompt = context.buildAiCliPrompt({
  userMessage: '总结注意力机制',
  contextItems: automatic,
  providerLabel: 'Codex',
  conversationMessages: [
    { role: 'user', content: '之前读过哪些 attention 论文？' },
    { role: 'assistant', content: '目前最相关的是 Attention Is All You Need。' },
  ],
});
assert.ok(prompt.includes('Aster 知识库上下文'));
assert.ok(prompt.includes('历史对话'));
assert.ok(prompt.includes('Attention Is All You Need'));
assert.ok(prompt.includes('总结注意力机制'));

console.log('AI context verification passed');
```

- [ ] **Step 3: 更新 package scripts**

Modify `package.json` scripts:

```json
{
  "test:ai-cli": "node scripts/verify-ai-cli.mjs",
  "test:ai-context": "node --experimental-strip-types scripts/verify-ai-context.mjs"
}
```

Keep the existing scripts unchanged and insert the two new keys next to the other `test:*` scripts.

- [ ] **Step 4: 更新总验证脚本**

Modify `scripts/verify-all.mjs` and include these commands in the verification list:

```js
['npm', ['run', 'test:ai-context']],
['npm', ['run', 'test:ai-cli']],
```

Put them before `npm run build` so structural problems fail quickly.

- [ ] **Step 5: 运行失败验证**

Run:

```powershell
npm run test:ai-cli
```

Expected: FAIL with `Missing file: src/features/ai/AiProviderPicker.tsx`.

Run:

```powershell
npm run test:ai-context
```

Expected: FAIL with a module-not-found error for `src/features/ai/aiContext.ts`.

---

### Task 2: 扩展核心 AI CLI 类型和 Provider 注册

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/asterCore.ts`
- Modify: `src/features/settings/index.tsx`

- [ ] **Step 1: 扩展核心类型**

Modify `src/core/types.ts` near the current AI provider types:

```ts
export type AiCliProviderId = 'claude' | 'codex' | 'copilot' | 'opencode' | 'pi';
export type AiPermissionMode = 'default' | 'autoReview' | 'fullAccess';
export type AiProviderRuntimeState = 'ready' | 'missing' | 'notLoggedIn' | 'unsupported' | 'error';
export type AiCliSessionStatus = 'idle' | 'starting' | 'running' | 'streaming' | 'stopped' | 'failed' | 'closed';
export type AiCliContextKind = 'paper' | 'note' | 'annotation' | 'tag';

export interface AiCliModel {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface AiCliProviderStatus {
  providerId: AiCliProviderId;
  state: AiProviderRuntimeState;
  label: string;
  binaryPath?: string;
  message?: string;
  models: AiCliModel[];
  permissionModes: AiPermissionMode[];
}

export interface AiCliContextReference {
  kind: AiCliContextKind;
  id: string;
  title: string;
  summary: string;
  metadata: Record<string, JsonValue>;
}

export interface AiCliThreadConfig {
  providerId: AiCliProviderId;
  modelId: string;
  permissionMode: AiPermissionMode;
  fixedContext: AiCliContextReference[];
}

export interface AiCliStreamEvent {
  sessionId: string;
  threadId: string;
  runId: string;
  event: 'started' | 'delta' | 'message' | 'stopped' | 'failed' | 'closed';
  content?: string;
  error?: string;
}
```

Extend `AiProviderContribution`:

```ts
export interface AiProviderContribution extends ProviderContribution {
  kind: 'local' | 'cli' | 'api';
  status: 'available' | 'planned' | 'disabled';
  description?: string;
  modelLabel?: string;
  supportsStreaming?: boolean;
  supportsContextObjects?: boolean;
  cliProviderId?: AiCliProviderId;
  defaultModelId?: string;
  models?: AiCliModel[];
  permissionModes?: AiPermissionMode[];
}
```

- [ ] **Step 2: 注册固定 Provider 列表**

Modify the AI provider setup in `src/core/asterCore.ts`: remove the old `aiProviders.set('local-context-assistant', ...)`, `aiProviders.set('codex-cli', ...)`, and `aiProviders.set('claude-code-cli', ...)` blocks, then register exactly these CLI providers:

```ts
const cliModels = {
  claude: [
    { id: 'sonnet', label: 'Claude Sonnet', recommended: true },
    { id: 'opus', label: 'Claude Opus' },
    { id: 'fable', label: 'Claude Fable' },
  ],
  codex: [
    { id: 'gpt-5.5', label: 'GPT-5.5', recommended: true },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
  ],
  copilot: [{ id: 'default', label: 'Copilot Default', recommended: true }],
  opencode: [{ id: 'default', label: 'OpenCode Default', recommended: true }],
  pi: [{ id: 'default', label: 'Pi Default', recommended: true }],
} satisfies Record<AiCliProviderId, AiCliModel[]>;

const cliPermissionModes: AiPermissionMode[] = ['default', 'autoReview', 'fullAccess'];

aiProviders.set('claude', {
  id: 'claude',
  name: 'Claude',
  kind: 'cli',
  status: 'planned',
  cliProviderId: 'claude',
  modelLabel: 'Claude Code',
  defaultModelId: 'sonnet',
  models: cliModels.claude,
  permissionModes: cliPermissionModes,
  description: '通过本机 Claude CLI 进行知识库对话。',
  supportsContextObjects: true,
  supportsStreaming: true,
  enabledByDefault: true,
});

aiProviders.set('codex', {
  id: 'codex',
  name: 'Codex',
  kind: 'cli',
  status: 'planned',
  cliProviderId: 'codex',
  modelLabel: 'Codex CLI',
  defaultModelId: 'gpt-5.5',
  models: cliModels.codex,
  permissionModes: cliPermissionModes,
  description: '通过本机 Codex CLI 进行知识库对话。',
  supportsContextObjects: true,
  supportsStreaming: true,
  enabledByDefault: true,
});
```

Register `copilot`, `opencode`, and `pi` using the same shape with their matching ids and `models` entries from `cliModels`.

- [ ] **Step 3: 更新设置页默认 Provider**

Modify `src/features/settings/index.tsx` default settings:

```ts
export const defaultSettings: AppSettings = {
  density: 'compact',
  defaultReaderLayout: 'focus',
  metadataSourcePreference: 'crossrefFirst',
  onlineMetadataEnabled: true,
  aiProviderId: 'codex',
};
```

Keep the rest of the settings UI unchanged; the AI Provider `<select>` will render the new fixed Provider list from `aster.aiProviders`.

- [ ] **Step 4: 运行结构验证**

Run:

```powershell
npm run test:ai-cli
```

Expected: FAIL with `Missing file: src/features/ai/AiProviderPicker.tsx`.

- [ ] **Step 5: 运行 TypeScript 构建**

Run:

```powershell
npm run build
```

Expected: PASS if imports were added correctly; if TypeScript reports missing `AiCliProviderId` import in `asterCore.ts`, add it to the existing import list from `./types`.

- [ ] **Step 6: Commit**

```powershell
git add src/core/types.ts src/core/asterCore.ts src/features/settings/index.tsx package.json scripts/verify-all.mjs scripts/verify-ai-cli.mjs scripts/verify-ai-context.mjs
git commit -m "feat: define ai cli provider model"
```

---

### Task 3: 实现知识库上下文检索和 prompt 构造

**Files:**
- Create: `src/features/ai/aiContext.ts`
- Modify: `src/features/ai/index.ts`

- [ ] **Step 1: 创建上下文 helper**

Create `src/features/ai/aiContext.ts`:

```ts
import type { AiCliContextReference, PaperDocument } from '../../core/types';

export interface AiContextSearchInput {
  papers: PaperDocument[];
  query: string;
  fixedReferences: AiCliContextReference[];
  limit?: number;
}

export interface AiCliConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiCliPromptInput {
  providerLabel: string;
  userMessage: string;
  contextItems: AiCliContextReference[];
  conversationMessages?: AiCliConversationMessage[];
}

export function searchAiKnowledgeContext({ papers, query, fixedReferences, limit = 8 }: AiContextSearchInput): AiCliContextReference[] {
  const fixedKeys = new Set(fixedReferences.map(contextKey));
  const automatic = rankKnowledgeItems(flattenKnowledgeItems(papers), query)
    .filter((item) => !fixedKeys.has(contextKey(item)))
    .slice(0, Math.max(0, limit - fixedReferences.length));
  return [...fixedReferences, ...automatic];
}

export function buildAiCliPrompt({ providerLabel, userMessage, contextItems, conversationMessages = [] }: AiCliPromptInput) {
  const contextBlock = contextItems.length
    ? contextItems.map((item, index) => formatContextItem(item, index + 1)).join('\n\n')
    : '当前没有检索到明确的知识库上下文。请说明这一点，并基于用户问题给出可执行的下一步建议。';
  const historyBlock = conversationMessages.length
    ? conversationMessages.slice(-12).map(formatConversationMessage).join('\n\n')
    : '没有可用的历史对话。';
  return [
    `你是 Aster 中的 ${providerLabel} 知识库助手。`,
    '你只能基于用户提供的问题和 Aster 知识库上下文作答。',
    '如果需要写入笔记、标签、关系或其它资料库数据，请只提出建议，不要声称已经写入。',
    '',
    '# Aster 知识库上下文',
    contextBlock,
    '',
    '# 历史对话',
    historyBlock,
    '',
    '# 当前用户问题',
    userMessage.trim(),
  ].join('\n');
}

function flattenKnowledgeItems(papers: PaperDocument[]): AiCliContextReference[] {
  return papers.flatMap((paper) => [
    paperReference(paper),
    ...paper.notes.map((note) => ({
      kind: 'note' as const,
      id: note.id,
      title: note.title || `${paper.title} 阅读笔记`,
      summary: note.content.slice(0, 500),
      metadata: { paperId: paper.paperId, paperTitle: paper.title },
    })),
    ...paper.annotations.map((annotation) => ({
      kind: 'annotation' as const,
      id: annotation.id,
      title: annotation.quote || annotation.comment || `${paper.title} 标注`,
      summary: [annotation.quote, annotation.comment].filter(Boolean).join('\n').slice(0, 500),
      metadata: { paperId: paper.paperId, paperTitle: paper.title, page: annotation.page, fileId: annotation.fileId },
    })),
    ...paper.tags.map((tag) => ({
      kind: 'tag' as const,
      id: tag,
      title: tag,
      summary: `标签 ${tag} 关联文献：${paper.title}`,
      metadata: { paperId: paper.paperId, paperTitle: paper.title },
    })),
  ]);
}

function paperReference(paper: PaperDocument): AiCliContextReference {
  return {
    kind: 'paper',
    id: paper.paperId,
    title: paper.title,
    summary: [paper.authors, paper.year, paper.venue, paper.tags.join(', ')].filter(Boolean).join(' · '),
    metadata: { paperId: paper.paperId, doi: paper.doi, sourceFileId: paper.sourceFileId },
  };
}

function rankKnowledgeItems(items: AiCliContextReference[], query: string) {
  const terms = query
    .toLocaleLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (!terms.length) return items.slice(0, 8);
  return items
    .map((item) => ({ item, score: scoreItem(item, terms) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title, 'zh-CN'))
    .map(({ item }) => item);
}

function scoreItem(item: AiCliContextReference, terms: string[]) {
  const haystack = [item.kind, item.title, item.summary, JSON.stringify(item.metadata)].join(' ').toLocaleLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function formatContextItem(item: AiCliContextReference, index: number) {
  return [`[${index}] ${item.kind}: ${item.title}`, `id: ${item.id}`, `summary: ${item.summary}`, `metadata: ${JSON.stringify(item.metadata)}`].join('\n');
}

function formatConversationMessage(message: AiCliConversationMessage, index: number) {
  return `[${index + 1}] ${message.role}: ${message.content.trim()}`;
}

function contextKey(item: AiCliContextReference) {
  return `${item.kind}:${item.id}`;
}
```

- [ ] **Step 2: 导出 helper**

Modify `src/features/ai/index.ts`:

```ts
export {
  buildAiCliPrompt,
  searchAiKnowledgeContext,
  type AiCliConversationMessage,
  type AiCliPromptInput,
  type AiContextSearchInput,
} from './aiContext';
```

Keep existing exports for `AIChatScene`, `AIChatMessage`, and `useChatThreads`.

- [ ] **Step 3: 运行上下文验证**

Run:

```powershell
npm run test:ai-context
```

Expected: PASS with `AI context verification passed`.

- [ ] **Step 4: 运行结构验证**

Run:

```powershell
npm run test:ai-cli
```

Expected: FAIL with `Missing file: src/features/ai/AiProviderPicker.tsx`.

- [ ] **Step 5: Commit**

```powershell
git add src/features/ai/aiContext.ts src/features/ai/index.ts scripts/verify-ai-context.mjs
git commit -m "feat: build ai knowledge context"
```

---

### Task 4: 创建独立 AI 对话 UI 组件

**Files:**
- Create: `src/features/ai/AiProviderPicker.tsx`
- Create: `src/features/ai/AiModelPicker.tsx`
- Create: `src/features/ai/AiPermissionPicker.tsx`
- Create: `src/features/ai/AiContextPicker.tsx`
- Create: `src/features/ai/AiMessageList.tsx`
- Create: `src/features/ai/AiComposer.tsx`
- Modify: `src/features/ai/AIChatScene.tsx`
- Modify: `src/features/ai/index.ts`
- Modify: `src/ui/styles/components.css`
- Modify: `src/ui/zh.ts`

- [ ] **Step 1: 创建 Provider picker**

Create `src/features/ai/AiProviderPicker.tsx`:

```tsx
import type { AiCliProviderId, AiCliProviderStatus, AiProviderContribution } from '../../core/types';

export function AiProviderPicker({
  providers,
  statuses,
  value,
  onChange,
}: {
  providers: AiProviderContribution[];
  statuses: AiCliProviderStatus[];
  value: AiCliProviderId;
  onChange: (providerId: AiCliProviderId) => void;
}) {
  const statusById = new Map(statuses.map((status) => [status.providerId, status]));
  return (
    <div className="ai-picker-menu" role="listbox" aria-label="AI Provider">
      {providers.map((provider) => {
        const providerId = provider.cliProviderId;
        if (!providerId) return null;
        const status = statusById.get(providerId);
        return (
          <button key={provider.id} type="button" className={value === providerId ? 'ai-provider-option active' : 'ai-provider-option'} onClick={() => onChange(providerId)}>
            <strong>{provider.name}</strong>
            <span>{statusLabel(status)}</span>
          </button>
        );
      })}
    </div>
  );
}

function statusLabel(status: AiCliProviderStatus | undefined) {
  if (!status) return '检测中';
  if (status.state === 'ready') return '可用';
  if (status.state === 'missing') return '未安装';
  if (status.state === 'notLoggedIn') return '未登录';
  if (status.state === 'unsupported') return '不支持';
  return '错误';
}
```

- [ ] **Step 2: 创建 model 和 permission picker**

Create `src/features/ai/AiModelPicker.tsx`:

```tsx
import type { AiCliModel } from '../../core/types';

export function AiModelPicker({ models, value, onChange }: { models: AiCliModel[]; value: string; onChange: (modelId: string) => void }) {
  return (
    <select className="ai-inline-select" value={value} onChange={(event) => onChange(event.target.value)} aria-label="AI 模型">
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.label}
        </option>
      ))}
    </select>
  );
}
```

Create `src/features/ai/AiPermissionPicker.tsx`:

```tsx
import type { AiPermissionMode } from '../../core/types';

const labels: Record<AiPermissionMode, string> = {
  default: 'Default permissions',
  autoReview: 'Auto-review',
  fullAccess: 'Full access',
};

export function AiPermissionPicker({
  modes,
  value,
  onChange,
}: {
  modes: AiPermissionMode[];
  value: AiPermissionMode;
  onChange: (mode: AiPermissionMode) => void;
}) {
  return (
    <select className="ai-inline-select" value={value} onChange={(event) => onChange(event.target.value as AiPermissionMode)} aria-label="AI 权限模式">
      {modes.map((mode) => (
        <option key={mode} value={mode}>
          {labels[mode]}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 3: 创建上下文 picker**

Create `src/features/ai/AiContextPicker.tsx`:

```tsx
import type { AiCliContextReference, PaperDocument } from '../../core/types';
import { searchAiKnowledgeContext } from './aiContext';

export function AiContextPicker({
  papers,
  query,
  fixedContext,
  onChange,
}: {
  papers: PaperDocument[];
  query: string;
  fixedContext: AiCliContextReference[];
  onChange: (context: AiCliContextReference[]) => void;
}) {
  const suggestions = searchAiKnowledgeContext({ papers, query, fixedReferences: [], limit: 8 });
  const selectedKeys = new Set(fixedContext.map((item) => `${item.kind}:${item.id}`));
  return (
    <div className="ai-context-picker">
      {suggestions.map((item) => {
        const key = `${item.kind}:${item.id}`;
        const selected = selectedKeys.has(key);
        return (
          <button
            key={key}
            type="button"
            className={selected ? 'ai-context-chip active' : 'ai-context-chip'}
            onClick={() => onChange(selected ? fixedContext.filter((current) => `${current.kind}:${current.id}` !== key) : [...fixedContext, item])}
          >
            <span>{item.kind}</span>
            <strong>{item.title}</strong>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: 创建消息流和输入框**

Create `src/features/ai/AiMessageList.tsx`:

```tsx
import type { AIChatMessage } from './AIChatScene';

export function AiMessageList({ messages, streaming }: { messages: AIChatMessage[]; streaming: boolean }) {
  return (
    <div className="ai-message-list" aria-live="polite">
      {messages.map((message) => (
        <div key={message.id} className={message.role === 'user' ? 'ai-message user' : 'ai-message assistant'}>
          {message.content}
        </div>
      ))}
      {streaming && <div className="ai-message assistant streaming">正在生成...</div>}
    </div>
  );
}
```

Create `src/features/ai/AiComposer.tsx`:

```tsx
import type { AiPermissionMode, AiCliModel } from '../../core/types';
import { AiModelPicker } from './AiModelPicker';
import { AiPermissionPicker } from './AiPermissionPicker';

export function AiComposer({
  draft,
  running,
  models,
  modelId,
  permissionModes,
  permissionMode,
  onDraftChange,
  onModelChange,
  onPermissionModeChange,
  onSend,
  onStop,
}: {
  draft: string;
  running: boolean;
  models: AiCliModel[];
  modelId: string;
  permissionModes: AiPermissionMode[];
  permissionMode: AiPermissionMode;
  onDraftChange: (draft: string) => void;
  onModelChange: (modelId: string) => void;
  onPermissionModeChange: (mode: AiPermissionMode) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  return (
    <div className="ai-composer">
      <textarea
        value={draft}
        placeholder="向本地 AI CLI 提问，使用 @ 固定知识库上下文"
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (running) onStop();
            else onSend();
          }
        }}
      />
      <div className="ai-composer-toolbar">
        <button type="button" className="rounded-button subtle-button" title="添加附件">
          +
        </button>
        <AiModelPicker models={models} value={modelId} onChange={onModelChange} />
        <AiPermissionPicker modes={permissionModes} value={permissionMode} onChange={onPermissionModeChange} />
        <button type="button" className="primary rounded-button" onClick={running ? onStop : onSend} disabled={!running && !draft.trim()}>
          {running ? '停止' : '发送'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 重组 AIChatScene**

Modify `src/features/ai/AIChatScene.tsx` so its props include provider state:

```ts
providerId: AiCliProviderId;
providerStatuses: AiCliProviderStatus[];
aiProviders: AiProviderContribution[];
modelId: string;
permissionMode: AiPermissionMode;
fixedContext: AiCliContextReference[];
running: boolean;
onProviderChange: (providerId: AiCliProviderId) => void;
onModelChange: (modelId: string) => void;
onPermissionModeChange: (mode: AiPermissionMode) => void;
onFixedContextChange: (context: AiCliContextReference[]) => void;
onStop: () => void;
```

Render the new layout:

```tsx
<div className="ai-workspace">
  <aside className="ai-sidebar">
    <AiProviderPicker providers={aiProviders} statuses={providerStatuses} value={providerId} onChange={onProviderChange} />
    <AiContextPicker papers={papers} query={draft} fixedContext={fixedContext} onChange={onFixedContextChange} />
  </aside>
  <section className="ai-chat-main">
    <AiMessageList messages={messages} streaming={running} />
    <AiComposer
      draft={draft}
      running={running}
      models={activeProvider.models ?? []}
      modelId={modelId}
      permissionModes={activeProvider.permissionModes ?? ['default']}
      permissionMode={permissionMode}
      onDraftChange={onDraftChange}
      onModelChange={onModelChange}
      onPermissionModeChange={onPermissionModeChange}
      onSend={onSend}
      onStop={onStop}
    />
  </section>
</div>
```

Set `activeProvider` from `aiProviders.find((provider) => provider.cliProviderId === providerId) ?? aiProviders[0]`.

- [ ] **Step 6: 导出新组件**

Modify `src/features/ai/index.ts`:

```ts
export { AiProviderPicker } from './AiProviderPicker';
export { AiModelPicker } from './AiModelPicker';
export { AiPermissionPicker } from './AiPermissionPicker';
export { AiContextPicker } from './AiContextPicker';
export { AiMessageList } from './AiMessageList';
export { AiComposer } from './AiComposer';
```

- [ ] **Step 7: 增加样式和文案**

Modify `src/ui/styles/components.css` and add stable dimensions:

```css
.ai-workspace { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 0; flex: 1; gap: 14px; }
.ai-sidebar { display: grid; grid-template-rows: auto 1fr; min-height: 0; gap: 12px; }
.ai-chat-main { display: grid; grid-template-rows: 1fr auto; min-height: 0; }
.ai-picker-menu, .ai-context-picker { display: grid; gap: 7px; align-content: start; overflow: auto; }
.ai-provider-option, .ai-context-chip { display: grid; grid-template-columns: 1fr auto; gap: 8px; width: 100%; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: white; color: var(--text); text-align: left; }
.ai-provider-option.active, .ai-context-chip.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-strong); }
.ai-message-list { display: grid; align-content: start; gap: 10px; min-height: 0; overflow: auto; padding: 16px; }
.ai-message { max-width: min(760px, 78%); padding: 11px 12px; border-radius: 8px; line-height: 1.55; white-space: pre-wrap; }
.ai-message.assistant { background: rgba(238,243,239,.88); color: var(--text); }
.ai-message.user { justify-self: end; background: #26312b; color: white; }
.ai-message.streaming { color: var(--muted); }
.ai-composer { display: grid; gap: 9px; padding: 12px; border-top: 1px solid var(--line); }
.ai-composer textarea { min-height: 92px; resize: vertical; }
.ai-composer-toolbar { display: flex; align-items: center; gap: 8px; }
.ai-inline-select { min-height: 34px; border: 1px solid var(--line); border-radius: 8px; background: white; color: var(--text); padding: 0 9px; }
```

Modify `src/ui/zh.ts` under `ai` with these keys:

```ts
providerUnavailable: 'Provider 不可用',
providerDetecting: '正在检测本机 CLI',
permissionDefault: 'Default permissions',
permissionAutoReview: 'Auto-review',
permissionFullAccess: 'Full access',
contextPicker: '知识库上下文',
```

- [ ] **Step 8: 运行结构验证**

Run:

```powershell
npm run test:ai-cli
```

Expected: FAIL with `Missing Tauri command: list_ai_cli_providers`.

- [ ] **Step 9: Commit**

```powershell
git add src/features/ai src/ui/styles/components.css src/ui/zh.ts
git commit -m "feat: build ai cli chat shell"
```

---

### Task 5: 增加 Tauri Provider 检测和命令构造

**Files:**
- Create: `src-tauri/src/ai_cli.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 创建 Rust AI CLI 模块**

Create `src-tauri/src/ai_cli.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CliProviderId {
    Claude,
    Codex,
    Copilot,
    OpenCode,
    Pi,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    Default,
    AutoReview,
    FullAccess,
}

#[derive(Debug, Clone, Serialize)]
pub struct CliModel {
    pub id: String,
    pub label: String,
    pub recommended: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProviderStatus {
    pub provider_id: String,
    pub state: String,
    pub label: String,
    pub binary_path: Option<String>,
    pub message: Option<String>,
    pub models: Vec<CliModel>,
    pub permission_modes: Vec<String>,
}

#[tauri::command]
pub fn list_ai_cli_providers() -> Result<Vec<CliProviderStatus>, String> {
    Ok(all_providers().into_iter().map(detect_provider).collect())
}

fn all_providers() -> Vec<CliProviderId> {
    vec![CliProviderId::Claude, CliProviderId::Codex, CliProviderId::Copilot, CliProviderId::OpenCode, CliProviderId::Pi]
}

fn detect_provider(provider: CliProviderId) -> CliProviderStatus {
    let binary = find_binary(binary_candidates(&provider));
    CliProviderStatus {
        provider_id: provider_id(&provider).to_string(),
        state: if binary.is_some() { "ready".to_string() } else { "missing".to_string() },
        label: provider_label(&provider).to_string(),
        binary_path: binary.map(|path| path.to_string_lossy().to_string()),
        message: None,
        models: default_models(&provider),
        permission_modes: vec!["default".to_string(), "autoReview".to_string(), "fullAccess".to_string()],
    }
}

fn binary_candidates(provider: &CliProviderId) -> &'static [&'static str] {
    match provider {
        CliProviderId::Claude => &["claude"],
        CliProviderId::Codex => &["codex"],
        CliProviderId::Copilot => &["gh"],
        CliProviderId::OpenCode => &["opencode"],
        CliProviderId::Pi => &["pi"],
    }
}

fn provider_id(provider: &CliProviderId) -> &'static str {
    match provider {
        CliProviderId::Claude => "claude",
        CliProviderId::Codex => "codex",
        CliProviderId::Copilot => "copilot",
        CliProviderId::OpenCode => "opencode",
        CliProviderId::Pi => "pi",
    }
}

fn provider_label(provider: &CliProviderId) -> &'static str {
    match provider {
        CliProviderId::Claude => "Claude",
        CliProviderId::Codex => "Codex",
        CliProviderId::Copilot => "Copilot",
        CliProviderId::OpenCode => "OpenCode",
        CliProviderId::Pi => "Pi",
    }
}

fn default_models(provider: &CliProviderId) -> Vec<CliModel> {
    match provider {
        CliProviderId::Claude => vec![model("sonnet", "Claude Sonnet", true), model("opus", "Claude Opus", false), model("fable", "Claude Fable", false)],
        CliProviderId::Codex => vec![model("gpt-5.5", "GPT-5.5", true), model("gpt-5.4", "GPT-5.4", false), model("gpt-5.4-mini", "GPT-5.4 Mini", false), model("gpt-5.3-codex", "GPT-5.3 Codex", false)],
        CliProviderId::Copilot => vec![model("default", "Copilot Default", true)],
        CliProviderId::OpenCode => vec![model("default", "OpenCode Default", true)],
        CliProviderId::Pi => vec![model("default", "Pi Default", true)],
    }
}

fn model(id: &str, label: &str, recommended: bool) -> CliModel {
    CliModel { id: id.to_string(), label: label.to_string(), recommended }
}

fn find_binary(candidates: &[&str]) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    for root in env::split_paths(&path) {
        for candidate in candidates {
            for executable in executable_names(candidate) {
                let full = root.join(executable);
                if full.is_file() {
                    return Some(full);
                }
            }
        }
    }
    None
}

fn executable_names(name: &str) -> Vec<String> {
    if cfg!(windows) {
        vec![format!("{name}.exe"), format!("{name}.cmd"), format!("{name}.bat"), format!("{name}.ps1")]
    } else {
        vec![name.to_string()]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_ids_are_stable() {
        assert_eq!(provider_id(&CliProviderId::Claude), "claude");
        assert_eq!(provider_id(&CliProviderId::Codex), "codex");
        assert_eq!(provider_id(&CliProviderId::Copilot), "copilot");
        assert_eq!(provider_id(&CliProviderId::OpenCode), "opencode");
        assert_eq!(provider_id(&CliProviderId::Pi), "pi");
    }

    #[test]
    fn codex_models_include_default() {
        let models = default_models(&CliProviderId::Codex);
        assert!(models.iter().any(|model| model.id == "gpt-5.5" && model.recommended));
    }
}
```

- [ ] **Step 2: 注册模块和命令**

Modify `src-tauri/src/lib.rs` near the top:

```rust
mod ai_cli;
```

Add `ai_cli::list_ai_cli_providers` to the `tauri::generate_handler!` list:

```rust
ai_cli::list_ai_cli_providers,
```

- [ ] **Step 3: 运行 Rust 测试**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml provider_ids_are_stable codex_models_include_default
```

Expected: PASS.

- [ ] **Step 4: 运行结构验证**

Run:

```powershell
npm run test:ai-cli
```

Expected: FAIL with `Missing native API wrapper: listAiCliProviders`.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/ai_cli.rs src-tauri/src/lib.rs
git commit -m "feat: detect local ai cli providers"
```

---

### Task 6: 增加前端 native API wrapper 和会话 DTO

**Files:**
- Modify: `src/platform/nativeApi.ts`

- [ ] **Step 1: 增加 DTO 类型**

Modify `src/platform/nativeApi.ts` imports:

```ts
import type { AiCliProviderId, AiCliProviderStatus, AiPermissionMode, AnnotationType, ImportDraft, PaperDocument, PositionJson } from '../core/types';
```

Add request/result interfaces after existing AI thread interfaces:

```ts
export interface StartAiCliSessionRequest {
  threadId?: string;
  providerId: AiCliProviderId;
  modelId: string;
  permissionMode: AiPermissionMode;
  prompt: string;
}

export interface StartAiCliSessionResult {
  session_id: string;
  thread_id: string;
  run_id: string;
}

export interface SendAiCliMessageRequest {
  sessionId: string;
  threadId: string;
  prompt: string;
}
```

- [ ] **Step 2: 增加 wrapper 函数**

Add these functions near the existing AI thread functions:

```ts
export async function listAiCliProviders() {
  return invoke<AiCliProviderStatus[]>('list_ai_cli_providers');
}

export async function startAiCliSession(request: StartAiCliSessionRequest) {
  return invoke<StartAiCliSessionResult>('start_ai_cli_session', {
    request: {
      thread_id: request.threadId ?? null,
      provider_id: request.providerId,
      model_id: request.modelId,
      permission_mode: request.permissionMode,
      prompt: request.prompt,
    },
  });
}

export async function sendAiCliMessage(request: SendAiCliMessageRequest) {
  return invoke<{ session_id: string; run_id: string }>('send_ai_cli_message', {
    request: {
      session_id: request.sessionId,
      thread_id: request.threadId,
      prompt: request.prompt,
    },
  });
}

export async function stopAiCliSession(sessionId: string) {
  return invoke<{ session_id: string }>('stop_ai_cli_session', { sessionId });
}

export async function closeAiCliSession(sessionId: string) {
  return invoke<{ session_id: string }>('close_ai_cli_session', { sessionId });
}
```

- [ ] **Step 3: 运行结构验证**

Run:

```powershell
npm run test:ai-cli
```

Expected: FAIL with `Missing Tauri command: start_ai_cli_session`.

- [ ] **Step 4: Commit**

```powershell
git add src/platform/nativeApi.ts
git commit -m "feat: add ai cli native api wrappers"
```

---

### Task 7: 实现 CLI 会话启动、输出事件和停止

**Files:**
- Modify: `src-tauri/src/ai_cli.rs`
- Modify: `src-tauri/src/lib.rs`

Implementation note: treat Codex/Claude/Copilot/OpenCode/Pi as non-interactive one-shot CLI processes. A frontend session can be long-running, but each user message starts a fresh child process with the full prompt, including recent conversation history and knowledge context.

- [ ] **Step 1: 增加 session state 和 request 类型**

Modify `src-tauri/src/ai_cli.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

#[derive(Default)]
pub struct AiCliSessionState {
    sessions: Mutex<HashMap<String, AiCliSession>>,
}

pub struct AiCliSession {
    thread_id: String,
    run_id: String,
    provider_id: String,
    model_id: String,
    permission_mode: String,
    child: Option<Child>,
}

#[derive(Debug, Deserialize)]
pub struct StartAiCliSessionRequest {
    thread_id: Option<String>,
    provider_id: String,
    model_id: String,
    permission_mode: String,
    prompt: String,
}

#[derive(Debug, Serialize)]
pub struct StartAiCliSessionResult {
    session_id: String,
    thread_id: String,
    run_id: String,
}

#[derive(Debug, Deserialize)]
pub struct SendAiCliMessageRequest {
    session_id: String,
    thread_id: String,
    prompt: String,
}

#[derive(Debug, Serialize)]
pub struct AiCliSessionResult {
    session_id: String,
    run_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiCliStreamEvent {
    session_id: String,
    thread_id: String,
    run_id: String,
    event: String,
    content: Option<String>,
    error: Option<String>,
}
```

- [ ] **Step 2: 增加命令构造函数**

Add command construction:

```rust
fn build_provider_command(provider_id: &str, model_id: &str, permission_mode: &str) -> Result<Command, String> {
    match provider_id {
        "codex" => {
            let mut command = Command::new("codex");
            command.args(["exec", "--json", "--skip-git-repo-check", "--model", model_id]);
            match permission_mode {
                "fullAccess" => {
                    command.arg("--dangerously-bypass-approvals-and-sandbox");
                }
                "autoReview" => {
                    command.args(["--ask-for-approval", "on-request", "--sandbox", "read-only"]);
                }
                _ => {
                    command.args(["--ask-for-approval", "on-request", "--sandbox", "workspace-write"]);
                }
            }
            command.arg("-");
            Ok(command)
        }
        "claude" => {
            let mut command = Command::new("claude");
            command.args(["--print", "--output-format", "stream-json", "--include-partial-messages", "--model", model_id]);
            match permission_mode {
                "fullAccess" => {
                    command.arg("--dangerously-skip-permissions");
                }
                "autoReview" => {
                    command.args(["--permission-mode", "plan"]);
                }
                _ => {
                    command.args(["--permission-mode", "manual"]);
                }
            }
            Ok(command)
        }
        "copilot" => {
            let mut command = Command::new("gh");
            command.args(["copilot", "-p"]);
            Ok(command)
        }
        "opencode" => {
            let mut command = Command::new("opencode");
            command.arg("run");
            Ok(command)
        }
        "pi" => {
            let mut command = Command::new("pi");
            Ok(command)
        }
        _ => Err(format!("Unsupported AI CLI provider: {provider_id}")),
    }
}
```

- [ ] **Step 3: 增加 start command**

Add command:

```rust
#[tauri::command]
pub fn start_ai_cli_session(app: AppHandle, state: State<AiCliSessionState>, request: StartAiCliSessionRequest) -> Result<StartAiCliSessionResult, String> {
    let session_id = format!("ai-cli-{}", Uuid::new_v4());
    let thread_id = request.thread_id.clone().unwrap_or_else(|| format!("thread-{}", Uuid::new_v4()));
    let run_id = format!("run-{}", Uuid::new_v4());
    let child = spawn_provider_process(
        app,
        session_id.clone(),
        thread_id.clone(),
        run_id.clone(),
        &request.provider_id,
        &request.model_id,
        &request.permission_mode,
        request.prompt,
    )?;
    state.sessions.lock().map_err(|error| error.to_string())?.insert(
        session_id.clone(),
        AiCliSession {
            thread_id: thread_id.clone(),
            run_id: run_id.clone(),
            provider_id: request.provider_id,
            model_id: request.model_id,
            permission_mode: request.permission_mode,
            child: Some(child),
        },
    );
    Ok(StartAiCliSessionResult { session_id, thread_id, run_id })
}
```

- [ ] **Step 4: 增加 send/stop/close commands**

Add commands:

```rust
#[tauri::command]
pub fn send_ai_cli_message(app: AppHandle, state: State<AiCliSessionState>, request: SendAiCliMessageRequest) -> Result<AiCliSessionResult, String> {
    let run_id = format!("run-{}", Uuid::new_v4());
    let (thread_id, provider_id, model_id, permission_mode, old_child) = {
        let mut sessions = state.sessions.lock().map_err(|error| error.to_string())?;
        let session = sessions.get_mut(&request.session_id).ok_or_else(|| "AI CLI session not found".to_string())?;
        if !request.thread_id.is_empty() {
            session.thread_id = request.thread_id.clone();
        }
        session.run_id = run_id.clone();
        (
            session.thread_id.clone(),
            session.provider_id.clone(),
            session.model_id.clone(),
            session.permission_mode.clone(),
            session.child.take(),
        )
    };

    if let Some(mut child) = old_child {
        let _ = child.kill();
    }

    let child = spawn_provider_process(app, request.session_id.clone(), thread_id, run_id.clone(), &provider_id, &model_id, &permission_mode, request.prompt)?;
    let mut sessions = state.sessions.lock().map_err(|error| error.to_string())?;
    let session = sessions.get_mut(&request.session_id).ok_or_else(|| "AI CLI session was closed".to_string())?;
    session.child = Some(child);
    Ok(AiCliSessionResult { session_id: request.session_id, run_id: Some(run_id) })
}

#[tauri::command]
pub fn stop_ai_cli_session(app: AppHandle, state: State<AiCliSessionState>, session_id: String) -> Result<AiCliSessionResult, String> {
    let mut sessions = state.sessions.lock().map_err(|error| error.to_string())?;
    let mut run_id = String::new();
    if let Some(mut session) = sessions.remove(&session_id) {
        run_id = session.run_id.clone();
        if let Some(mut child) = session.child.take() {
            let _ = child.kill();
        }
    }
    emit_event(&app, &session_id, "", &run_id, "stopped", None, None)?;
    Ok(AiCliSessionResult { session_id, run_id: None })
}

#[tauri::command]
pub fn close_ai_cli_session(app: AppHandle, state: State<AiCliSessionState>, session_id: String) -> Result<AiCliSessionResult, String> {
    let mut sessions = state.sessions.lock().map_err(|error| error.to_string())?;
    let mut run_id = String::new();
    if let Some(mut session) = sessions.remove(&session_id) {
        run_id = session.run_id.clone();
        if let Some(mut child) = session.child.take() {
            let _ = child.kill();
        }
    }
    emit_event(&app, &session_id, "", &run_id, "closed", None, None)?;
    Ok(AiCliSessionResult { session_id, run_id: None })
}
```

- [ ] **Step 5: 增加 reader 和 event helper**

Add helpers:

```rust
fn spawn_provider_process(
    app: AppHandle,
    session_id: String,
    thread_id: String,
    run_id: String,
    provider_id: &str,
    model_id: &str,
    permission_mode: &str,
    prompt: String,
) -> Result<Child, String> {
    let mut command = build_provider_command(provider_id, model_id, permission_mode)?;
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| format!("Failed to start AI CLI: {error}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes()).map_err(|error| error.to_string())?;
        stdin.write_all(b"\n").map_err(|error| error.to_string())?;
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    emit_event(&app, &session_id, &thread_id, &run_id, "started", None, None)?;
    spawn_reader(app.clone(), session_id.clone(), thread_id.clone(), run_id.clone(), stdout, "delta");
    spawn_reader(app, session_id, thread_id, run_id, stderr, "failed");
    Ok(child)
}

fn spawn_reader<R: std::io::Read + Send + 'static>(
    app: AppHandle,
    session_id: String,
    thread_id: String,
    run_id: String,
    stream: Option<R>,
    event_name: &'static str,
) {
    if let Some(stream) = stream {
        std::thread::spawn(move || {
            let reader = BufReader::new(stream);
            for line in reader.lines() {
                match line {
                    Ok(content) if !content.trim().is_empty() => {
                        let _ = emit_event(&app, &session_id, &thread_id, &run_id, event_name, Some(content), None);
                    }
                    Ok(_) => {}
                    Err(error) => {
                        let _ = emit_event(&app, &session_id, &thread_id, &run_id, "failed", None, Some(error.to_string()));
                    }
                }
            }
            let _ = emit_event(&app, &session_id, &thread_id, &run_id, "closed", None, None);
        });
    }
}

fn emit_event(
    app: &AppHandle,
    session_id: &str,
    thread_id: &str,
    run_id: &str,
    event: &str,
    content: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    app.emit(
        "ai-cli://event",
        AiCliStreamEvent {
            session_id: session_id.to_string(),
            thread_id: thread_id.to_string(),
            run_id: run_id.to_string(),
            event: event.to_string(),
            content,
            error,
        },
    )
    .map_err(|error| error.to_string())
}
```

- [ ] **Step 6: 注册 state 和 commands**

Modify `src-tauri/src/lib.rs` in `run()`:

```rust
.manage(ai_cli::AiCliSessionState::default())
```

Add these handlers:

```rust
ai_cli::start_ai_cli_session,
ai_cli::send_ai_cli_message,
ai_cli::stop_ai_cli_session,
ai_cli::close_ai_cli_session,
```

- [ ] **Step 7: 增加命令构造测试**

Add tests in `src-tauri/src/ai_cli.rs`:

```rust
#[test]
fn codex_default_command_uses_safe_approval() {
    let command = build_provider_command("codex", "gpt-5.5", "default").unwrap();
    let args = command.get_args().map(|arg| arg.to_string_lossy().to_string()).collect::<Vec<_>>();
    assert!(args.contains(&"exec".to_string()));
    assert!(args.contains(&"--json".to_string()));
    assert!(args.contains(&"--ask-for-approval".to_string()));
    assert!(args.contains(&"workspace-write".to_string()));
}

#[test]
fn claude_auto_review_uses_plan_permission() {
    let command = build_provider_command("claude", "sonnet", "autoReview").unwrap();
    let args = command.get_args().map(|arg| arg.to_string_lossy().to_string()).collect::<Vec<_>>();
    assert!(args.contains(&"--print".to_string()));
    assert!(args.contains(&"stream-json".to_string()));
    assert!(args.contains(&"plan".to_string()));
}
```

- [ ] **Step 8: 运行验证**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml codex_default_command_uses_safe_approval claude_auto_review_uses_plan_permission
npm run test:ai-cli
```

Expected: Rust tests PASS. `npm run test:ai-cli` PASS with `AI CLI structure verification passed`.

- [ ] **Step 9: Commit**

```powershell
git add src-tauri/src/ai_cli.rs src-tauri/src/lib.rs
git commit -m "feat: manage ai cli sessions"
```

---

### Task 8: 扩展数据库保存 Provider、模型、权限和上下文

**Files:**
- Modify: `src-tauri/schema.sql`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/platform/nativeApi.ts`

- [ ] **Step 1: 增加 schema 字段**

Modify `src-tauri/schema.sql` table `ai_threads`:

```sql
  permission_mode TEXT,
  context_json TEXT,
  status TEXT DEFAULT 'idle',
```

Place these fields after `model TEXT,`.

- [ ] **Step 2: 增加迁移语句**

Modify `initialize_database` in `src-tauri/src/lib.rs`:

```rust
let _ = connection.execute("ALTER TABLE ai_threads ADD COLUMN permission_mode TEXT", []);
let _ = connection.execute("ALTER TABLE ai_threads ADD COLUMN context_json TEXT", []);
let _ = connection.execute("ALTER TABLE ai_threads ADD COLUMN status TEXT DEFAULT 'idle'", []);
```

- [ ] **Step 3: 扩展 AI thread summary**

Modify `AiThreadSummary` in `src-tauri/src/lib.rs`:

```rust
    permission_mode: String,
    context_json: String,
    status: String,
```

Update `list_ai_threads_with_messages` SQL:

```sql
SELECT id, COALESCE(paper_id, ''), title, COALESCE(provider, ''), COALESCE(model, ''), COALESCE(permission_mode, ''), COALESCE(context_json, ''), COALESCE(status, 'idle'), created_at, updated_at
FROM ai_threads
WHERE paper_id = ?1
ORDER BY updated_at DESC
```

Map row indexes in the same order.

- [ ] **Step 4: 扩展 append request**

Modify `AppendAiMessageRequest`:

```rust
    provider: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
    context_json: Option<String>,
```

When creating a thread in `append_ai_message_in_database`, insert:

```sql
INSERT INTO ai_threads (id, paper_id, title, provider, model, permission_mode, context_json, status, created_at, updated_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
```

Use:

```rust
params![
    id,
    request.paper_id,
    "知识库对话",
    request.provider.as_deref().unwrap_or(""),
    request.model.as_deref().unwrap_or(""),
    request.permission_mode.as_deref().unwrap_or("default"),
    request.context_json.as_deref().unwrap_or("[]"),
    "idle",
    now,
    now,
]
```

- [ ] **Step 5: 更新 frontend DTO**

Modify `NativeAiThread` in `src/platform/nativeApi.ts`:

```ts
  permission_mode: string;
  context_json: string;
  status: string;
```

Modify `appendNativeAiMessage` request type:

```ts
provider?: string;
model?: string;
permissionMode?: string;
contextJson?: string;
```

Pass the new fields to Tauri:

```ts
provider: request.provider ?? null,
model: request.model ?? null,
permission_mode: request.permissionMode ?? null,
context_json: request.contextJson ?? null,
```

- [ ] **Step 6: 运行后端测试**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml import_pdf_tags_translation_and_ai_thread_roundtrip
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src-tauri/schema.sql src-tauri/src/lib.rs src/platform/nativeApi.ts
git commit -m "feat: persist ai cli thread metadata"
```

---

### Task 9: 连接前端 hook、Tauri 事件和会话保存

**Files:**
- Modify: `src/features/ai/useChatThreads.ts`
- Modify: `src/ui/App.tsx`

- [ ] **Step 1: 扩展 hook 输入和状态**

Modify `useChatThreads` params:

```ts
  providerId: AiCliProviderId;
  modelId: string;
  permissionMode: AiPermissionMode;
  fixedContext: AiCliContextReference[];
```

Add `LocalChatThread` fields:

```ts
sessionId?: string;
runId?: string;
running?: boolean;
providerId?: AiCliProviderId;
modelId?: string;
permissionMode?: AiPermissionMode;
fixedContext?: AiCliContextReference[];
```

- [ ] **Step 2: 订阅 Tauri event**

In `useChatThreads.ts`, import:

```ts
import { listen } from '@tauri-apps/api/event';
import { buildAiCliPrompt, searchAiKnowledgeContext } from './aiContext';
import { closeAiCliSession, listAiCliProviders, sendAiCliMessage, startAiCliSession, stopAiCliSession } from '../../platform/nativeApi';
```

Add effect:

```ts
useEffect(() => {
  if (!isTauriRuntime()) return;
  let dispose: (() => void) | undefined;
  void listen<{ sessionId: string; threadId: string; runId: string; event: string; content?: string; error?: string }>('ai-cli://event', (event) => {
    const payload = event.payload;
    setChatState((current) => applyCliEvent(current, payload));
  }).then((unlisten) => {
    dispose = unlisten;
  });
  return () => {
    dispose?.();
  };
}, []);
```

Add `applyCliEvent`:

```ts
function applyCliEvent(current: Record<string, LocalChatThread>, event: { threadId: string; runId: string; event: string; content?: string; error?: string }) {
  const entry = Object.entries(current).find(([, thread]) => thread.threadId === event.threadId);
  if (!entry) return current;
  const [paperId, thread] = entry;
  if (event.event === 'started') {
    return { ...current, [paperId]: { ...thread, runId: event.runId, running: true, error: '' } };
  }
  if (event.runId && thread.runId && event.runId !== thread.runId) return current;
  if (event.event === 'delta' && event.content) {
    const messages = appendAssistantDelta(thread.messages, event.content);
    return { ...current, [paperId]: { ...thread, messages, running: true } };
  }
  if (event.event === 'stopped' || event.event === 'closed') {
    return { ...current, [paperId]: { ...thread, running: false } };
  }
  if (event.event === 'failed') {
    return { ...current, [paperId]: { ...thread, running: false, error: event.error || event.content || 'AI CLI 运行失败' } };
  }
  return current;
}
```

Add `appendAssistantDelta`:

```ts
function appendAssistantDelta(messages: AIChatMessage[], delta: string): AIChatMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && last.id.startsWith('stream-')) {
    return [...messages.slice(0, -1), { ...last, content: `${last.content}${delta}\n` }];
  }
  return [...messages, { id: `stream-${Date.now()}`, role: 'assistant', content: `${delta}\n` }];
}
```

- [ ] **Step 3: 改造发送逻辑**

Replace `sendChatMessage` provider call with:

```ts
const currentMessages = currentThread?.messages ?? createDefaultChatMessages(paper, aiProvider);
const conversationMessages = currentMessages
  .flatMap((message) => (message.role === 'user' || message.role === 'assistant' ? [{ role: message.role, content: message.content }] : []));
const contextItems = searchAiKnowledgeContext({
  papers: aster.documents.list(),
  query: draft,
  fixedReferences: fixedContext,
  limit: 10,
});
const prompt = buildAiCliPrompt({
  providerLabel: aiProvider.name,
  userMessage: draft,
  contextItems,
  conversationMessages,
});
const userMessage = { id: `user-${Date.now()}`, role: 'user' as const, content: draft };
setChatState((current) => ({
  ...current,
  [paperId]: {
    ...current[paperId],
    messages: [...currentMessages, userMessage],
    draft: '',
    running: true,
    error: '',
    providerId,
    modelId,
    permissionMode,
    fixedContext,
  },
}));
const saved = isTauriRuntime()
  ? await appendNativeAiMessage({
      paperId,
      threadId: currentThread?.threadId,
      role: 'user',
      content: draft,
      provider: providerId,
      model: modelId,
      permissionMode,
      contextJson: JSON.stringify(contextItems),
    })
  : { thread_id: currentThread?.threadId ?? `local-thread-${paperId}-${Date.now()}`, message_id: userMessage.id };
const sessionResult = isTauriRuntime()
  ? currentThread?.sessionId
    ? await sendAiCliMessage({ sessionId: currentThread.sessionId, threadId: saved.thread_id, prompt })
    : await startAiCliSession({ threadId: saved.thread_id, providerId, modelId, permissionMode, prompt })
  : { session_id: `local-session-${Date.now()}`, thread_id: saved.thread_id, run_id: `local-run-${Date.now()}` };
const threadId = 'thread_id' in sessionResult ? sessionResult.thread_id : saved.thread_id;
setChatState((current) => ({
  ...current,
  [paperId]: {
    ...current[paperId],
    threadId,
    sessionId: sessionResult.session_id,
    runId: sessionResult.run_id,
    running: true,
  },
}));
```

- [ ] **Step 4: 增加停止逻辑**

Add to hook return:

```ts
stopChatGeneration,
providerStatuses,
refreshProviderStatuses,
```

Implement:

```ts
const stopChatGeneration = async (paperId: string) => {
  const sessionId = chatState[paperId]?.sessionId;
  if (sessionId && isTauriRuntime()) {
    await stopAiCliSession(sessionId);
  }
  setChatState((current) => ({
    ...current,
    [paperId]: {
      ...current[paperId],
      running: false,
    },
  }));
};
```

- [ ] **Step 5: 在 App 中管理 provider/model/permission/context**

Modify `src/ui/App.tsx` near AI state:

```ts
const [aiProviderId, setAiProviderId] = useState<AiCliProviderId>('codex');
const [aiModelId, setAiModelId] = useState('gpt-5.5');
const [aiPermissionMode, setAiPermissionMode] = useState<AiPermissionMode>('autoReview');
const [aiFixedContext, setAiFixedContext] = useState<AiCliContextReference[]>([]);
```

Pass these into `useChatThreads` and `AIChatScene`.

- [ ] **Step 6: 运行前端构建**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/features/ai/useChatThreads.ts src/ui/App.tsx
git commit -m "feat: connect ai cli chat sessions"
```

---

### Task 10: 最终验证和桌面端手动检查

**Files:**
- No code changes expected in this task.

- [ ] **Step 1: 运行 AI 验证**

Run:

```powershell
npm run test:ai-context
npm run test:ai-cli
```

Expected:

```text
AI context verification passed
AI CLI structure verification passed
```

- [ ] **Step 2: 运行架构和构建验证**

Run:

```powershell
npm run test:architecture
npm run build
```

Expected: both commands exit with code 0.

- [ ] **Step 3: 运行总验证**

Run:

```powershell
npm run verify
```

Expected: exit code 0.

- [ ] **Step 4: 运行后端测试**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml
```

Expected: all Rust tests pass.

- [ ] **Step 5: 桌面端手动验证 Codex**

Run:

```powershell
npm run tauri:dev
```

Manual check:

- Open `AI 对话`.
- Confirm Codex and Claude show as available on the current machine.
- Confirm Copilot/OpenCode/Pi show as unavailable when their binaries are not present.
- Select Codex, model `GPT-5.5`, permission `Auto-review`.
- Ask `基于当前知识库，列出最重要的三条阅读线索。`
- Confirm the assistant message streams into the message list.
- Press stop during a second prompt and confirm the UI leaves running state.
- Restart the app and confirm the saved AI thread can be loaded.

- [ ] **Step 6: Commit verification notes if docs changed**

If implementation notes are added to project docs, commit them:

```powershell
git add docs
git commit -m "docs: record ai cli verification"
```

If no docs changed, skip the commit and record command output in the PR or final implementation summary.

---

## Spec Coverage Review

- 独立 AI 对话场景：Task 4 and Task 9.
- 只支持 Claude、Codex、Copilot、OpenCode、Pi：Task 2 and Task 5.
- 本地 CLI Provider 检测：Task 5 and Task 6.
- Provider/model/permission/context UI：Task 4.
- 混合知识库上下文：Task 3 and Task 9.
- 长期会话、流式输出、停止：Task 7 and Task 9.
- 会话保存、Provider/model/permission/context metadata：Task 8 and Task 9.
- 不改阅读器侧边栏：No task modifies `src/features/reader/ReaderChatPanel.tsx`.
- 不做 Provider 市场、自定义 Provider、云端 API、向量检索：No task adds those surfaces.
- 验证：Task 1, Task 10.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-08-ai-chat-cli.md`. Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration.

2. Inline Execution - execute tasks in this session using executing-plans, batch execution with checkpoints.
