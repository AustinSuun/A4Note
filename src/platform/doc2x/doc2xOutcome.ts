/**
 * Doc2X run outcome mapping (doc2x-translate-0).
 *
 * Deliberately free of Tauri imports so the success/failure/timeout mapping can
 * be verified in Node with a fake runner; `doc2xRunner.ts` adds the bindings.
 */
import {
  describeDoc2xFailure,
  parseDoc2xReceiptText,
  type Doc2xCommandRequest,
  type Doc2xCommandResult,
  type Doc2xFailure,
  type Doc2xReceipt,
} from './doc2xCli.ts';

export type Doc2xRunner = (request: Doc2xCommandRequest) => Promise<Doc2xCommandResult>;

export type Doc2xRunOutcome =
  | { kind: 'success'; receipt: Doc2xReceipt | null }
  | { kind: 'failed'; failure: Doc2xFailure; stderr: string }
  | { kind: 'timeout' }
  | { kind: 'error'; message: string };

/**
 * Maps one CLI run onto an outcome the UI can render. A timeout, a non-zero
 * exit code or a spawn failure never becomes "success", and stdout that is not
 * JSON keeps `receipt: null` instead of inventing one.
 */
export async function runDoc2xTask(
  request: Doc2xCommandRequest,
  runner: Doc2xRunner,
): Promise<Doc2xRunOutcome> {
  let result: Doc2xCommandResult;
  try {
    result = await runner(request);
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  if (result.timedOut) return { kind: 'timeout' };
  const failure = describeDoc2xFailure(result.status);
  if (failure) return { kind: 'failed', failure, stderr: result.stderr };
  return { kind: 'success', receipt: parseDoc2xReceiptText(result.stdout) };
}
