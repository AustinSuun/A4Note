import { useEffect, useMemo, useRef, useState } from 'react';
import { Settings as SettingsGlyph } from 'lucide-react';
import type { PaperDocument } from '../../core/types';
import { zh } from '../../ui/zh';

export type AIChatMessage = { id: string; role: 'user' | 'assistant'; content: string };
export type AiReasoningLevel = 'standard' | 'high' | 'extraHigh';
export type AiRunMode = 'fast' | 'plan';
export type AiToolProviderId = 'claude' | 'codex' | 'copilot' | 'opencode' | 'pi';

type AiToolModel = { id: string; label: string; description: string; favorite?: boolean };
type AiToolProvider = { id: AiToolProviderId; label: string; status: 'ready' | 'error'; models: AiToolModel[] };

const modelOptions: Record<AiToolProviderId, AiToolModel[]> = {
  claude: [
    { id: 'claude-sonnet', label: 'Claude Sonnet', description: 'Balanced model for research reading and writing.' },
    { id: 'claude-opus', label: 'Claude Opus', description: 'Deeper reasoning for difficult synthesis tasks.' },
    { id: 'claude-haiku', label: 'Claude Haiku', description: 'Fast model for short notes and lightweight Q&A.' },
  ],
  codex: [
    { id: 'gpt-5.5', label: 'GPT-5.5', description: 'Frontier model for complex coding, research, and analysis.', favorite: true },
    { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Strong model for everyday coding.' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini', description: 'Small, fast, and cost-efficient model for quick work.' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3-codex', description: 'Coding-optimized model.' },
    { id: 'gpt-5.2', label: 'GPT-5.2', description: 'Optimized for professional work and long-running tasks.' },
  ],
  copilot: [{ id: 'copilot-default', label: 'Copilot', description: 'GitHub Copilot CLI default model.' }],
  opencode: [{ id: 'opencode-default', label: 'OpenCode', description: 'OpenCode CLI default model.' }],
  pi: [{ id: 'pi-default', label: 'Pi', description: 'Pi CLI default model.' }],
};

const toolProviders: AiToolProvider[] = [
  { id: 'claude', label: 'Claude', status: 'ready', models: modelOptions.claude },
  { id: 'codex', label: 'Codex', status: 'ready', models: modelOptions.codex },
  { id: 'copilot', label: 'Copilot', status: 'error', models: modelOptions.copilot },
  { id: 'opencode', label: 'OpenCode', status: 'error', models: modelOptions.opencode },
  { id: 'pi', label: 'Pi', status: 'error', models: modelOptions.pi },
];

const reasoningOptions: Array<{ id: AiReasoningLevel; label: string }> = [
  { id: 'standard', label: 'Standard' },
  { id: 'high', label: 'High' },
  { id: 'extraHigh', label: 'Extra high' },
];

const permissionOptions = [
  { id: 'default', label: 'Default permissions' },
  { id: 'autoReview', label: 'Auto-review' },
  { id: 'fullAccess', label: 'Full access' },
];

export type AIChatSceneProps = {
  papers: PaperDocument[];
  selectedPaper: PaperDocument;
  messages: AIChatMessage[];
  draft: string;
  error: string;
  providerId: AiToolProviderId;
  modelId: string;
  reasoningLevel: AiReasoningLevel;
  permissionMode: string;
  runMode: AiRunMode;
  onSelectPaper: (paperId: string) => void;
  onDraftChange: (draft: string) => void;
  onAiProviderChange: (providerId: AiToolProviderId) => void;
  onAiModelChange: (modelId: string) => void;
  onAiReasoningChange: (reasoningLevel: AiReasoningLevel) => void;
  onAiPermissionChange: (permissionMode: string) => void;
  onAiRunModeChange: (runMode: AiRunMode) => void;
  onSend: () => void;
  onReset: () => void;
};

export function AIChatScene({
  papers,
  selectedPaper,
  messages,
  draft,
  error,
  providerId,
  modelId,
  reasoningLevel,
  permissionMode,
  runMode,
  onSelectPaper,
  onDraftChange,
  onAiProviderChange,
  onAiModelChange,
  onAiReasoningChange,
  onAiPermissionChange,
  onAiRunModeChange,
  onSend,
  onReset,
}: AIChatSceneProps) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const activeProvider = toolProviders.find((provider) => provider.id === providerId) ?? toolProviders[1];
  const activeModels = modelOptions[activeProvider.id] ?? [];
  const activeModel = activeModels.find((option) => option.id === modelId)?.label ?? activeModels[0]?.label ?? modelId;
  const activePermission = permissionOptions.find((option) => option.id === permissionMode)?.label ?? permissionMode;
  const hasUserMessages = messages.some((message) => message.role === 'user');
  const canSwitchProvider = !hasUserMessages;
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLocaleLowerCase();
    if (!query) return activeModels;
    return activeModels.filter((model) => `${model.label} ${model.description}`.toLocaleLowerCase().includes(query));
  }, [activeModels, modelSearch]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setModelMenuOpen(false);
        setProviderPickerOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [modelMenuOpen]);

  const selectProvider = (nextProviderId: AiToolProviderId) => {
    if (!canSwitchProvider) return;
    const nextModel = modelOptions[nextProviderId][0];
    onAiProviderChange(nextProviderId);
    if (nextModel) onAiModelChange(nextModel.id);
    setProviderPickerOpen(false);
    setModelSearch('');
  };

  const selectModel = (nextModelId: string) => {
    onAiModelChange(nextModelId);
    setModelMenuOpen(false);
    setProviderPickerOpen(false);
    setModelSearch('');
  };

  return (
    <section className="scene active">
      <header className="topbar compact">
        <div>
          <h1>{zh.ai.title}</h1>
          <p className="scene-description">{zh.ai.subtitle}</p>
        </div>
        <div className="provider-pill">{activeModel} · {activePermission}</div>
      </header>
      <div className="ai-layout">
        <aside className="soft-panel chat-list">
          {papers.map((paper) => (
            <button key={paper.paperId} className={paper.paperId === selectedPaper.paperId ? 'chat-item active' : 'chat-item'} type="button" onClick={() => onSelectPaper(paper.paperId)}>
              <strong>{paper.title}</strong>
              <span>{zh.ai.boundTopics(paper.aiThreads.length)}</span>
            </button>
          ))}
        </aside>
        <section className="chat-room">
          <div className="context-banner">
            <div>
              {zh.ai.context}: {selectedPaper.title} / {readerPdfStatusLabel(selectedPaper)}
            </div>
            <button type="button" className="subtle-banner-button rounded-button" onClick={onReset}>
              {zh.ai.newThread}
            </button>
          </div>
          <div className="messages">
            {messages.map((message) => (
              <div key={message.id} className={message.role === 'user' ? 'message user' : 'message'}>
                {message.content}
              </div>
            ))}
          </div>
          {error && <div className="chat-error">{error}</div>}
          <div className="ai-composer-shell">
            <div className="ai-toolbar" aria-label="AI 对话工具栏">
              <button type="button" className="ai-icon-button" aria-label="添加上下文" title="添加上下文">
                <PlusIcon />
              </button>
              <div className="ai-model-picker" ref={pickerRef}>
                <button type="button" className="ai-model-trigger" onClick={() => setModelMenuOpen((open) => !open)} aria-label="选择模型">
                  <ToolProviderIcon id={activeProvider.id} />
                  <span>{activeModel}</span>
                  <ChevronDownIcon />
                </button>
                {modelMenuOpen && (
                  <div className="ai-picker-popover">
                    {providerPickerOpen ? (
                      <div className="ai-provider-menu">
                        {toolProviders.map((provider) => (
                          <button
                            key={provider.id}
                            type="button"
                            className={provider.id === providerId ? 'ai-picker-row active' : 'ai-picker-row'}
                            onClick={() => selectProvider(provider.id)}
                            disabled={!canSwitchProvider}
                          >
                            <ToolProviderIcon id={provider.id} />
                            <strong>{provider.label}</strong>
                            <span>{provider.status === 'ready' ? `${provider.models.length} 个模型` : '错误'}</span>
                            <ChevronRightIcon />
                          </button>
                        ))}
                        {!canSwitchProvider && <div className="ai-picker-lock-note">当前会话已有消息，工具已锁定。新会话可切换工具。</div>}
                      </div>
                    ) : (
                      <div className="ai-model-menu">
                        <div className="ai-picker-header">
                          <button
                            type="button"
                            className="ai-picker-back"
                            onClick={() => setProviderPickerOpen(true)}
                            disabled={!canSwitchProvider}
                            aria-label="切换工具"
                          >
                            <BackIcon />
                          </button>
                          <ToolProviderIcon id={activeProvider.id} />
                          <strong>{activeProvider.label}</strong>
                          <button type="button" className="ai-picker-settings" aria-label="模型设置" title="模型设置">
                            <SettingsGlyph size={16} strokeWidth={1.9} aria-hidden="true" />
                          </button>
                        </div>
                        <label className="ai-model-search">
                          <SearchIcon />
                          <input value={modelSearch} placeholder="搜索模型..." onChange={(event) => setModelSearch(event.target.value)} />
                        </label>
                        <div className="ai-picker-list">
                          {filteredModels.map((model) => (
                            <button key={model.id} type="button" className={model.id === modelId ? 'ai-model-row active' : 'ai-model-row'} onClick={() => selectModel(model.id)}>
                              <ToolProviderIcon id={activeProvider.id} />
                              <strong>{model.label}</strong>
                              <span>{model.description}</span>
                              {model.id === modelId ? <CheckIcon /> : <StarIcon active={Boolean(model.favorite)} />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <label className="ai-tool-select">
                <ReasoningIcon />
                <select
                  className="ai-reasoning-select"
                  value={reasoningLevel}
                  onChange={(event) => onAiReasoningChange(event.target.value as AiReasoningLevel)}
                  aria-label="推理强度"
                >
                  {reasoningOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ai-tool-select">
                <ShieldIcon />
                <select className="ai-permission-select" value={permissionMode} onChange={(event) => onAiPermissionChange(event.target.value)} aria-label="权限模式">
                  {permissionOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={runMode === 'fast' ? 'ai-mode-button active' : 'ai-mode-button'}
                aria-label="Fast 模式"
                title="Fast 模式"
                onClick={() => onAiRunModeChange('fast')}
              >
                <LightningIcon />
              </button>
              <button
                type="button"
                className={runMode === 'plan' ? 'ai-mode-button active' : 'ai-mode-button'}
                aria-label="Plan 模式"
                title="Plan 模式"
                onClick={() => onAiRunModeChange('plan')}
              >
                <PlanIcon />
              </button>
            </div>
            <div className="prompt-bar">
              <input
                value={draft}
                placeholder={zh.ai.input}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    onSend();
                  }
                }}
              />
              <button type="button" className="primary rounded-button" onClick={onSend} disabled={!draft.trim()}>
                {zh.ai.send}
              </button>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function readerPdfStatusLabel(paper: PaperDocument) {
  if (paper.translatedPdfs.length) return zh.reader.translatedPdf;
  if (paper.sourcePdf) return zh.reader.sourcePdf;
  return zh.ai.noPdf;
}

function PlusIcon() {
  return <Icon path="M12 5v14M5 12h14" />;
}

function ToolProviderIcon({ id }: { id: AiToolProviderId }) {
  if (id === 'claude') return <Icon path="M12 4 14.4 9.2 20 12l-5.6 2.8L12 20l-2.4-5.2L4 12l5.6-2.8L12 4Z" />;
  if (id === 'copilot') return <Icon path="M7 15v-3a5 5 0 0 1 10 0v3M6 14h12v3.5A2.5 2.5 0 0 1 15.5 20h-7A2.5 2.5 0 0 1 6 17.5V14Zm3 2h.01M15 16h.01M9 9 7 7M15 9l2-2" />;
  if (id === 'opencode') return <Icon path="M7 5h10v14H7V5Zm3 4h4M10 12h4M10 15h4" />;
  if (id === 'pi') return <Icon path="M7 6h10M9 6v12M15 6v12M5 18h6M13 18h6" />;
  return <Icon path="M8.5 5.5 12 3.5l3.5 2 3.5 2v4L15.5 14 12 16l-3.5-2L5 11.5v-4l3.5-2Zm0 0v4L12 11.5l3.5-2v-4M8.5 13.5v-4M15.5 13.5v-4M5 7.5l3.5 2M19 7.5l-3.5 2M12 11.5V16" />;
}

function ReasoningIcon() {
  return <Icon path="M8 10a4 4 0 1 1 8 0c0 1.8-1 2.8-2.2 3.7-.6.5-.8 1-.8 1.8h-2c0-1.5.5-2.5 1.6-3.3.9-.7 1.4-1.2 1.4-2.2a2 2 0 1 0-4 0H8Zm3 8h2" />;
}

function ShieldIcon() {
  return <Icon path="M12 4 19 7v5.5c0 3.5-2.5 5.8-7 7.5-4.5-1.7-7-4-7-7.5V7l7-3Zm0 4v5M12 16h.01" />;
}

function LightningIcon() {
  return <Icon path="M13 3 5.5 13H12l-1 8 7.5-10H12l1-8Z" />;
}

function PlanIcon() {
  return <Icon path="M7 6.5h10M7 12h10M7 17.5h10M4 6.5h.01M4 12h.01M4 17.5h.01" />;
}

function ChevronDownIcon() {
  return <Icon path="M7 10l5 5 5-5" />;
}

function ChevronRightIcon() {
  return <Icon path="M10 7l5 5-5 5" />;
}

function BackIcon() {
  return <Icon path="M15 6l-6 6 6 6M9 12h10" />;
}

function SettingsIcon() {
  return <Icon path="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm7.2 2.3 1.3 1-1.3 1a7.5 7.5 0 0 1-.5 1.2l.4 1.6-1.6.9-1.2-1a7 7 0 0 1-1.2.7l-.2 1.6h-1.8l-.2-1.6a7 7 0 0 1-1.2-.7l-1.2 1-1.6-.9.4-1.6a7.5 7.5 0 0 1-.5-1.2l-1.3-1 1.3-1a7.5 7.5 0 0 1 .5-1.2l-.4-1.6 1.6-.9 1.2 1a7 7 0 0 1 1.2-.7l.2-1.6h1.8l.2 1.6a7 7 0 0 1 1.2.7l1.2-1 1.6.9-.4 1.6c.2.4.4.8.5 1.2Z" />;
}

function SearchIcon() {
  return <Icon path="M11 6a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm4 9 4 4" />;
}

function CheckIcon() {
  return <Icon path="M5 12.5 10 17l9-10" />;
}

function StarIcon({ active }: { active: boolean }) {
  return <Icon path={active ? 'M12 4.5 14.2 9l4.8.7-3.5 3.4.8 4.9L12 15.7 7.7 18l.8-4.9L5 9.7 9.8 9 12 4.5Z' : 'M12 4.5 14.2 9l4.8.7-3.5 3.4.8 4.9L12 15.7 7.7 18l.8-4.9L5 9.7 9.8 9 12 4.5Z'} />;
}

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
