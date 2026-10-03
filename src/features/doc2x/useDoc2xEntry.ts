import { useCallback, useMemo } from 'react';
import type { PaperDocument } from '../../core/types.ts';
import {
  buildDoc2xAccountStatusRequest,
  buildDoc2xLoginRequest,
  buildDoc2xLogoutRequest,
  runDoc2xCommand,
  startDoc2xLogin,
} from '../../platform/doc2x/index.ts';
import { readDoc2xTranslateSettings } from './doc2xSettings.ts';
import { preflightDoc2xEntry, resolveDoc2xEntryRoot, translatePaperWithDoc2x } from './doc2xEntry.ts';
import { describeDoc2xEntryDisabled, summarizeDoc2xEntryBatch } from './doc2xEntryPlan.ts';

/**
 * What the library entries and the plugin commands need. Every method resolves
 * to a message meant for the user, so the caller never has to invent one.
 */
export interface Doc2xLibraryEntry {
  enabled: boolean;
  translate: (paperIds: string[]) => Promise<string>;
  login: () => Promise<string>;
  logout: () => Promise<string>;
  accountStatus: () => Promise<string>;
}

const SUCCESS_PREFIX = '译文已回到该文献';

/**
 * Lives at the app root, not in the workbench panel: the panel only mounts when
 * the user opens it, so panel-owned handlers left every entry answering "插件未
 * 就绪" until that happened.
 */
export function useDoc2xLibraryEntry(input: {
  papers: PaperDocument[];
  settingValues: Record<string, unknown>;
}): Doc2xLibraryEntry {
  const { papers, settingValues } = input;
  const resolution = useMemo(() => readDoc2xTranslateSettings(settingValues), [settingValues]);
  const papersById = useMemo(
    () => new Map(papers.map((paper) => [paper.paperId, paper])),
    [papers],
  );

  const translate = useCallback(
    async (paperIds: string[]) => {
      if (!resolution.enabled) return describeDoc2xEntryDisabled();
      const targets = paperIds
        .map((paperId) => papersById.get(paperId))
        .filter((paper): paper is PaperDocument => Boolean(paper));
      if (!targets.length) return '未找到要翻译的文献，请重新选择后再试。';
      if (resolution.errors.length) return `Doc2X 设置需要修正：${resolution.errors.join('；')}`;
      const preflight = await preflightDoc2xEntry();
      if (!preflight.ready) return preflight.message;
      const messages: string[] = [];
      let successes = 0;
      for (const target of targets) {
        const message = await translatePaperWithDoc2x(target, resolution.settings, preflight.root);
        messages.push(message);
        if (message.startsWith(SUCCESS_PREFIX)) successes += 1;
      }
      return summarizeDoc2xEntryBatch(messages, successes);
    },
    [papersById, resolution],
  );

  const login = useCallback(async () => {
    const root = await resolveDoc2xEntryRoot();
    try {
      const jobId = await startDoc2xLogin(buildDoc2xLoginRequest(root || '.'));
      return `已启动登录任务 ${jobId}：请在弹出的浏览器里授权你的 Doc2X 账号，完成后点「查询额度/订阅」确认。`;
    } catch (error) {
      return `启动登录失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }, []);

  const logout = useCallback(async () => {
    const root = await resolveDoc2xEntryRoot();
    const outcome = await runDoc2xCommand(buildDoc2xLogoutRequest(root || '.'));
    if (outcome.kind === 'success') return '已退出 Doc2X 登录。';
    if (outcome.kind === 'failed') return outcome.failure.message;
    return '退出登录失败，请重试。';
  }, []);

  const accountStatus = useCallback(async () => {
    const root = await resolveDoc2xEntryRoot();
    const outcome = await runDoc2xCommand(buildDoc2xAccountStatusRequest(root || '.'));
    if (outcome.kind === 'success') return '已获取账号状态，详情见 Doc2X 面板。';
    if (outcome.kind === 'failed') return outcome.failure.message;
    return '查询账号超时，请重试。';
  }, []);

  return { enabled: resolution.enabled, translate, login, logout, accountStatus };
}
