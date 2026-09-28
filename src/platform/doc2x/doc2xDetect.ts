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
  parseDoc2xVersion,
  type Doc2xCliStatus,
  type Doc2xCommandResult,
} from './doc2xCli';

/**
 * `run_project_command` reports a non-zero status instead of throwing when the
 * executable is missing, so a missing CLI stays an explainable state rather
 * than an unhandled error.
 */
export async function detectDoc2xCli(cwd = '.'): Promise<Doc2xCliStatus> {
  try {
    const result = await invoke<Doc2xCommandResult>('run_project_command', {
      request: { cwd, command: DOC2X_COMMAND, args: ['--version'] },
    });
    if (result.status !== 0) {
      return {
        available: false,
        version: '',
        nodeMajor: null,
        message: `未检测到 doc2x 命令，请先安装 @noedgeai-org/doc2x-cli（需要 Node.js ${DOC2X_MIN_NODE_MAJOR} 及以上）`,
      };
    }
    return { available: true, version: parseDoc2xVersion(result.stdout), nodeMajor: null, message: '' };
  } catch (error) {
    return {
      available: false,
      version: '',
      nodeMajor: null,
      message: `无法运行 doc2x 命令：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
