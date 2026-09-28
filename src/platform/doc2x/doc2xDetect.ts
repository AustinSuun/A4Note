/**
 * Doc2X CLI detection (doc2x-translate-0).
 *
 * Thin Tauri binding around the existing `run_project_command` primitive: the
 * CLI is a plain npm executable (`doc2x`), so availability and version are a
 * normal command probe. Credentials stay inside the CLI's own token file.
 */
import { invoke } from '@tauri-apps/api/core';
import {
  DOC2X_COMMAND,
  DOC2X_MIN_NODE_MAJOR,
  describeDoc2xMissingCli,
  parseNodeMajor,
  parseDoc2xVersion,
  type Doc2xCliStatus,
  type Doc2xCommandResult,
} from './doc2xCli.ts';

/**
 * `run_project_command` reports a non-zero status instead of throwing when the
 * executable is missing, so a missing CLI stays an explainable state rather
 * than an unhandled error.
 */
/** `node --version` decides whether the one-click install can run at all. */
async function detectNodeMajor(cwd: string): Promise<number | null> {
  try {
    const result = await invoke<Doc2xCommandResult>('run_project_command', {
      request: { cwd, command: 'node', args: ['--version'] },
    });
    return result.status === 0 ? parseNodeMajor(result.stdout) : null;
  } catch {
    return null;
  }
}

export async function detectDoc2xCli(cwd = '.'): Promise<Doc2xCliStatus> {
  const nodeMajor = await detectNodeMajor(cwd);
  try {
    const result = await invoke<Doc2xCommandResult>('run_project_command', {
      request: { cwd, command: DOC2X_COMMAND, args: ['--version'] },
    });
    if (result.status !== 0) {
      return {
        available: false,
        version: '',
        nodeMajor,
        message: describeDoc2xMissingCli(nodeMajor),
      };
    }
    const tooOld = nodeMajor !== null && nodeMajor < DOC2X_MIN_NODE_MAJOR;
    return {
      available: true,
      version: parseDoc2xVersion(result.stdout),
      nodeMajor,
      message: tooOld ? describeDoc2xMissingCli(nodeMajor) : '',
    };
  } catch (error) {
    return {
      available: false,
      version: '',
      nodeMajor,
      message: `无法运行 doc2x 命令：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}