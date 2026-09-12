import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scene = readFileSync('src/features/ai/AIChatScene.tsx', 'utf8');
const app = readFileSync('src/ui/App.tsx', 'utf8');
const contributions = readFileSync('src/features/ai/contributions.tsx', 'utf8');
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
  "ai-composer-shell",
  "ai-provider-menu",
  "ai-model-menu",
  "ai-model-search",
  "ai-picker-popover",
  "ai-reasoning-select",
  "ai-permission-select",
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

assert.ok(contributions.includes("id: 'ai.core.view'"), 'AI view must be a plugin contribution');
assert.ok(contributions.includes("id: 'ai.sessions'"), 'AI sidebar must be a plugin contribution');

for (const text of ['ai-composer-card', 'ai-composer-input', 'ai-composer-footer', 'reasoningMenuOpen', 'permissionMenuOpen']) {
  assert.equal(scene.includes(text), false, `AIChatScene should not include: ${text}`);
}

for (const text of [
  "useState<AiToolProviderId>('codex')",
  "useState('gpt-5.5')",
  "useState<AiReasoningLevel>('extraHigh')",
  "useState('autoReview')",
  "useState<AiRunMode>('fast')",
  'onAiProviderChange: setAiProviderId',
  'onAiModelChange: setAiModelId',
  'onAiReasoningChange: setAiReasoningLevel',
  'onAiPermissionChange: setAiPermissionMode',
  'onAiRunModeChange: setAiRunMode',
]) {
  assert.ok(app.includes(text), `App AI toolbar state missing: ${text}`);
}

for (const text of ['.ai-toolbar', '.ai-composer-shell', '.ai-tool-select', '.ai-model-trigger', '.ai-picker-popover', '.ai-picker-row', '.ai-mode-button', '.ai-mode-button.active']) {
  assert.ok(styles.includes(text), `AI toolbar style missing: ${text}`);
}

console.log('AI toolbar verification passed');
