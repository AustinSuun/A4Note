/**
 * Doc2X CLI execution bindings (doc2x-translate-0).
 *
 * Thin Tauri bindings over `src-tauri/src/doc2x_cli.rs`. The outcome mapping
 * lives in `doc2xOutcome.ts` (no Tauri imports) so it stays testable in Node.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Doc2xCommandRequest, Doc2xCommandResult } from './doc2xCli.ts';
import { runDoc2xTask, type Doc2xRunOutcome, type Doc2xRunner } from './doc2xOutcome.ts';

/** Mirrors `DOC2X_EVENT` in `src-tauri/src/doc2x_cli.rs`. */
export const DOC2X_EVENT = 'doc2x://event';

export type Doc2xJobStream = 'stdout' | 'stderr' | 'status';

export interface Doc2xJobEvent {
  jobId: string;
  stream: Doc2xJobStream;
  line: string;
}

export interface Doc2xJobExit {
  jobId: string;
  status: number | null;
  timedOut: boolean;
}

/** Default runner: the bounded async Tauri command. */
export const invokeDoc2xRunner: Doc2xRunner = (request) =>
  invoke<Doc2xCommandResult>('run_doc2x_command', { request });

export async function runDoc2xCommand(
  request: Doc2xCommandRequest,
  runner: Doc2xRunner = invokeDoc2xRunner,
): Promise<Doc2xRunOutcome> {
  return runDoc2xTask(request, runner);
}

export async function startDoc2xLogin(request: Doc2xCommandRequest): Promise<string> {
  return invoke<string>('start_doc2x_login', { request });
}

export async function cancelDoc2xJob(jobId: string): Promise<boolean> {
  return invoke<boolean>('cancel_doc2x_job', { jobId });
}

export interface Doc2xLoginHandlers {
  onEvent?: (event: Doc2xJobEvent) => void;
  onExit?: (exit: Doc2xJobExit) => void;
}

/**
 * Subscribes to the single `doc2x://event` channel. Progress lines and the exit
 * notification are separated by payload shape, so a login can surface the
 * browser URL and still report "waiting for authorization" honestly.
 */
export async function listenDoc2xLoginEvents(handlers: Doc2xLoginHandlers): Promise<UnlistenFn> {
  return listen<Doc2xJobEvent | Doc2xJobExit>(DOC2X_EVENT, (event) => {
    const payload = event.payload;
    if (payload && typeof payload === 'object' && 'line' in payload) {
      handlers.onEvent?.(payload as Doc2xJobEvent);
      return;
    }
    if (payload && typeof payload === 'object' && 'jobId' in payload) {
      handlers.onExit?.(payload as Doc2xJobExit);
    }
  });
}

export { runDoc2xTask, type Doc2xRunOutcome, type Doc2xRunner } from './doc2xOutcome.ts';
