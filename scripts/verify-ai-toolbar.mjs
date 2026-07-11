import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scene = readFileSync('src/features/ai/AIChatScene.tsx', 'utf8');
const app = readFileSync('src/ui/App.tsx', 'utf8');
const styles = readFileSync('src/ui/styles/components.css', 'utf8');

for (const text of [
  "export type AiReasoningLevel",
  "export type AiRunMode",
  "export type AiToolProviderId",
  "modelOptions",
  "toolProviders",
  "reasoningOptions",
  "permissionOptions",
  "modelMenuOpen",
  "providerPickerOpen",
  "canSwitchProvider",
  "hasUserMessages",
  "ai-model-trigger",
  "ai-composer-card",
  "ai-composer-input",
  "ai-composer-footer",
  "ai-provider-menu",
  "ai-model-menu",
  "ai-model-search",
  "ai-choice-popover",
  "reasoningMenuOpen",
  "permissionMenuOpen",
  "Claude",
  "Codex",
  "Copilot",
  "OpenCode",
  "Pi",
  "aria-label=\"Fast 模式\"",
  "aria-label=\"Plan 模式\"",
]) {
  assert.ok(scene.includes(text), `AIChatScene toolbar missing: ${text}`);
}

for (const text of ['<header className="topbar compact">', 'zh.ai.title', 'zh.ai.subtitle', 'provider-pill', 'className="ai-reasoning-select"', 'className="ai-permission-select"', 'title="Fast 模式"', 'title="Plan 模式"']) {
  assert.equal(scene.includes(text), false, `AIChatScene should not include: ${text}`);
}

for (const text of [
  "useState<AiToolProviderId>('codex')",
  "useState('gpt-5.5')",
  "useState<AiReasoningLevel>('extraHigh')",
  "useState('autoReview')",
  "useState<AiRunMode>('fast')",
  'onAiProviderChange={setAiProviderId}',
  'onAiModelChange={setAiModelId}',
  'onAiReasoningChange={setAiReasoningLevel}',
  'onAiPermissionChange={setAiPermissionMode}',
  'onAiRunModeChange={setAiRunMode}',
]) {
  assert.ok(app.includes(text), `App AI toolbar state missing: ${text}`);
}

for (const text of ['.ai-toolbar', '.ai-composer-card', '.ai-composer-input', '.ai-composer-footer', '.ai-tool-trigger', '.ai-model-trigger', '.ai-picker-popover', '.ai-choice-popover', '.ai-picker-row', '.ai-mode-button', '.ai-mode-button.active']) {
  assert.ok(styles.includes(text), `AI toolbar style missing: ${text}`);
}

for (const text of ['border-radius: 999px', 'border-radius: 12px', 'border-radius: 14px']) {
  assert.equal(styles.includes(text), false, `AI toolbar styles should avoid oversized radius: ${text}`);
}

console.log('AI toolbar verification passed');
