/**
 * Doc2X library entry orchestration (doc2x-entry-arena).
 *
 * The library context menu and the detail panel call these helpers directly, so
 * a translation can start without opening the Doc2X workbench panel first.
 * Message text comes from `doc2xEntryPlan.ts`; this file owns the Tauri calls.
 */
import type { PaperDocument } from '../../core/types.ts';
import { getAsterPaths, importTranslatedPdfToLibrary } from '../../platform/nativeApi.ts';
import {
  DOC2X_MIN_NODE_MAJOR,
  buildDoc2xTranslateRequest,
  detectDoc2xCli,
  runDoc2xCommand,
  type Doc2xCliStatus,
  type Doc2xTranslateSettings,
} from '../../platform/doc2x/index.ts';
import { buildDoc2xRunPaths, createDoc2xRunId, resolveDoc2xSourcePath } from './doc2xSettings.ts';
import {
  describeDoc2xEntryCli,
  describeDoc2xEntryFailure,
  describeDoc2xEntryMissingPdf,
  describeDoc2xEntryNoOutput,
  describeDoc2xEntrySuccess,
  describeDoc2xEntryTimeout,
} from './doc2xEntryPlan.ts';

/** The CLI and the translations live under the app files root, as in the panel. */
export async function resolveDoc2xEntryRoot(): Promise<string> {
  try {
    const paths = await getAsterPaths();
    return paths.files_root ?? paths.root ?? '';
  } catch {
    return '';
  }
}

export interface Doc2xEntryPreflight {
  root: string;
  cli: Doc2xCliStatus;
  /** True only when a translation can actually run. */
  ready: boolean;
  /** Chinese, user facing, with the next step. */
  message: string;
}

/**
 * A missing CLI is a normal state, not an exception: detection reports it and
 * the caller renders the install/login guidance instead of failing silently.
 */
export async function preflightDoc2xEntry(): Promise<Doc2xEntryPreflight> {
  const root = await resolveDoc2xEntryRoot();
  let cli: Doc2xCliStatus;
  try {
    cli = await detectDoc2xCli(root || '.');
  } catch (error) {
    cli = {
      available: false,
      version: '',
      nodeMajor: null,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const tooOld = cli.nodeMajor !== null && cli.nodeMajor < DOC2X_MIN_NODE_MAJOR;
  return {
    root,
    cli,
    ready: cli.available && !tooOld && !cli.message,
    message: describeDoc2xEntryCli(cli),
  };
}

/**
 * One paper, one run directory, one honest result string. The prefix
 * `译文已回到该文献` marks success for callers that count outcomes.
 */
export async function translatePaperWithDoc2x(
  target: PaperDocument,
  settings: Doc2xTranslateSettings,
  root: string,
): Promise<string> {
  const source = resolveDoc2xSourcePath(target, root);
  if (!source) return describeDoc2xEntryMissingPdf(target.title);
  const paths = buildDoc2xRunPaths(root, target.paperId, createDoc2xRunId());
  const outcome = await runDoc2xCommand(
    buildDoc2xTranslateRequest(
      { path: source, bytes: 0 },
      settings,
      { out: paths.out, receiptPath: paths.receiptPath },
      root || '.',
    ),
  );
  if (outcome.kind === 'failed') return describeDoc2xEntryFailure(outcome.failure);
  if (outcome.kind === 'timeout') return describeDoc2xEntryTimeout();
  if (outcome.kind === 'error') return outcome.message;
  const outputs = outcome.receipt?.outputFiles ?? [];
  if (!outputs.length) return describeDoc2xEntryNoOutput();
  const primary = outputs.find((file) => /\.pdf$/i.test(file)) ?? outputs[0];
  try {
    await importTranslatedPdfToLibrary({
      paperId: target.paperId,
      originalPath: primary,
      language: settings.targetLanguage,
    });
  } catch (error) {
    return `译文已生成，但登记回文献失败：${error instanceof Error ? error.message : String(error)}（文件：${primary}）`;
  }
  return describeDoc2xEntrySuccess(primary);
}
