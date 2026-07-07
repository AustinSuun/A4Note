import { useEffect, useState } from 'react';
import type { createAsterCore } from '../../core/asterCore';
import { runAiProvider } from '../../core/aiProviders';
import { buildPaperKnowledgeGraph } from '../../core/relations';
import type { AiProviderContribution, AiProviderRunResult, AiThreadContext, PaperDocument } from '../../core/types';
import type { AIChatMessage } from './AIChatScene';
import { appendNativeAiMessage, clearNativeAiThreads, isTauriRuntime, listNativeAiThreads } from '../../platform/nativeApi';
import { zh } from '../../ui/zh';

type AsterCore = ReturnType<typeof createAsterCore>;

export type LocalChatThread = { threadId?: string; messages: AIChatMessage[]; draft: string; loading?: boolean; error?: string; contexts?: AiThreadContext[] };

export function useChatThreads({
  aster,
  selectedPaper,
  aiProvider,
  refreshNativeDocuments,
}: {
  aster: AsterCore;
  selectedPaper: PaperDocument | null;
  aiProvider: AiProviderContribution;
  refreshNativeDocuments: (preferredPaperId?: string) => Promise<void>;
}) {
  const [chatState, setChatState] = useState<Record<string, LocalChatThread>>({});

  useEffect(() => {
    if (!selectedPaper || !isTauriRuntime()) return;
    let cancelled = false;
    setChatState((current) => ({
      ...current,
      [selectedPaper.paperId]: {
        threadId: current[selectedPaper.paperId]?.threadId,
        messages: current[selectedPaper.paperId]?.messages ?? createDefaultChatMessages(selectedPaper, aiProvider),
        contexts: current[selectedPaper.paperId]?.contexts ?? [],
        draft: current[selectedPaper.paperId]?.draft ?? '',
        loading: true,
      },
    }));
    listNativeAiThreads(selectedPaper.paperId)
      .then((threads) => {
        if (cancelled) return;
        const latest = threads[0];
        setChatState((current) => ({
          ...current,
          [selectedPaper.paperId]: {
            threadId: latest?.id,
            messages: latest?.messages.length ? latest.messages.map(nativeAiMessageToLocal) : createDefaultChatMessages(selectedPaper, aiProvider),
            contexts: current[selectedPaper.paperId]?.contexts ?? [],
            draft: current[selectedPaper.paperId]?.draft ?? '',
            loading: false,
          },
        }));
      })
      .catch((error) => {
        console.error('Failed to load AI thread', error);
        if (cancelled) return;
        setChatState((current) => ({
          ...current,
          [selectedPaper.paperId]: {
            threadId: current[selectedPaper.paperId]?.threadId,
            messages: current[selectedPaper.paperId]?.messages ?? createDefaultChatMessages(selectedPaper, aiProvider),
            contexts: current[selectedPaper.paperId]?.contexts ?? [],
            draft: current[selectedPaper.paperId]?.draft ?? '',
            loading: false,
          },
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [aiProvider.id, selectedPaper?.paperId]);

  const selectedChatState = selectedPaper ? chatState[selectedPaper.paperId] : undefined;
  const chatMessages = selectedChatState?.messages ?? createDefaultChatMessages(selectedPaper, aiProvider);
  const chatDraft = selectedChatState?.draft ?? '';
  const chatError = selectedChatState?.error ?? '';
  const getAiThreadContextsForPaper = (paperId: string) => chatState[paperId]?.contexts ?? [];

  const updateChatDraft = (paperId: string, draft: string) => {
    setChatState((current) => ({
      ...current,
      [paperId]: {
        threadId: current[paperId]?.threadId,
        messages: current[paperId]?.messages ?? createDefaultChatMessages(aster.documents.get(paperId), aiProvider),
        contexts: current[paperId]?.contexts ?? [],
        draft,
        error: '',
      },
    }));
  };

  const sendChatMessage = async (paperId: string) => {
    const paper = aster.documents.get(paperId);
    const currentThread = chatState[paperId];
    const draft = (currentThread?.draft ?? '').trim();
    if (!paper || !draft) return;
    const existingContexts = currentThread?.contexts ?? [];
    const aiResult = await runAiProvider({ provider: aiProvider, paper, graph: buildPaperKnowledgeGraph(paper, { aiThreadContexts: existingContexts }), prompt: draft });
    const assistantReply = aiResult.content;
    const optimisticThreadId = currentThread?.threadId ?? `local-thread-${paperId}-${Date.now()}`;
    const optimisticContext = createAiThreadContext(optimisticThreadId, aiResult, draft);
    const nextMessages = [
      ...(currentThread?.messages ?? createDefaultChatMessages(paper, aiProvider)),
      { id: `user-${Date.now()}`, role: 'user' as const, content: draft },
      { id: `assistant-${Date.now() + 1}`, role: 'assistant' as const, content: assistantReply },
    ];
    setChatState((current) => ({
      ...current,
      [paperId]: {
        threadId: optimisticThreadId,
        messages: nextMessages,
        contexts: upsertAiThreadContext(currentThread?.contexts ?? [], optimisticContext),
        draft: '',
        error: '',
      },
    }));
    if (isTauriRuntime()) {
      try {
        const userSaved = await appendNativeAiMessage({ paperId, threadId: currentThread?.threadId, role: 'user', content: draft });
        const assistantSaved = await appendNativeAiMessage({ paperId, threadId: userSaved.thread_id, role: 'assistant', content: assistantReply });
        setChatState((current) => ({
          ...current,
          [paperId]: {
            threadId: assistantSaved.thread_id,
            messages: nextMessages,
            contexts: upsertAiThreadContext(current[paperId]?.contexts ?? [], { ...optimisticContext, threadId: assistantSaved.thread_id }, optimisticThreadId),
            draft: current[paperId]?.draft ?? '',
            loading: false,
            error: '',
          },
        }));
        await refreshNativeDocuments(paperId);
      } catch (error) {
        console.error('Failed to persist AI messages', error);
        setChatState((current) => ({
          ...current,
          [paperId]: {
            threadId: current[paperId]?.threadId,
            messages: current[paperId]?.messages ?? nextMessages,
            contexts: current[paperId]?.contexts ?? [optimisticContext],
            draft: current[paperId]?.draft ?? '',
            loading: false,
            error: zh.ai.saveFailed,
          },
        }));
      }
    }
  };

  const resetChatThread = async (paperId: string) => {
    const paper = aster.documents.get(paperId);
    if (!paper) return;
    if (isTauriRuntime()) {
      try {
        await clearNativeAiThreads(paperId);
        await refreshNativeDocuments(paperId);
      } catch (error) {
        console.error('Failed to clear AI thread', error);
        setChatState((current) => ({
          ...current,
          [paperId]: {
            threadId: current[paperId]?.threadId,
            messages: current[paperId]?.messages ?? createDefaultChatMessages(paper, aiProvider),
            contexts: current[paperId]?.contexts ?? [],
            draft: current[paperId]?.draft ?? '',
            loading: false,
            error: zh.ai.resetFailed,
          },
        }));
        throw error;
      }
    }
    setChatState((current) => ({
      ...current,
      [paperId]: {
        threadId: undefined,
        messages: createDefaultChatMessages(paper, aiProvider),
        contexts: [],
        draft: '',
        error: '',
      },
    }));
  };

  return {
    chatMessages,
    chatDraft,
    chatError,
    getAiThreadContextsForPaper,
    updateChatDraft,
    sendChatMessage,
    resetChatThread,
  };
}

function createAiThreadContext(threadId: string, result: AiProviderRunResult, prompt: string): AiThreadContext {
  return {
    threadId,
    providerId: result.providerId,
    prompt,
    objectIds: result.usedContext.objectIds.filter((objectId) => !objectId.startsWith('ai_thread:')),
    relationIds: result.usedContext.relationIds,
    createdAt: new Date().toISOString(),
  };
}

function upsertAiThreadContext(contexts: AiThreadContext[], context: AiThreadContext, replaceThreadId?: string) {
  const targetThreadIds = new Set([context.threadId, replaceThreadId].filter(Boolean));
  return [...contexts.filter((item) => !targetThreadIds.has(item.threadId)), context];
}

function createDefaultChatMessages(paper: PaperDocument | null | undefined, provider: AiProviderContribution): AIChatMessage[] {
  if (!paper) return [];
  return [
    { id: `system-${paper.paperId}`, role: 'assistant', content: zh.ai.systemMessage(paper.annotations.length, provider.name) },
    { id: `hint-${paper.paperId}`, role: 'assistant', content: zh.ai.providerHint },
  ];
}

function nativeAiMessageToLocal(message: { id: string; role: string; content: string }): AIChatMessage {
  return {
    id: message.id,
    role: message.role === 'user' ? 'user' : 'assistant',
    content: message.content,
  };
}
