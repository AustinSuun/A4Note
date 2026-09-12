/**
 * Agent CLI detection (part of CLI-0).
 *
 * Detection only: starting, streaming and stopping arrive with the Rust
 * supervisor in CLI-1. Nothing here pretends a session can run yet.
 */
import { invoke } from '@tauri-apps/api/core';
import type { AgentProviderId } from '../../core/workspace';

export interface AgentCliStatus {
  command: string;
  available: boolean;
  executable_path: string;
  version: string;
  error: string;
}

export interface AgentProviderDescriptor {
  id: AgentProviderId;
  label: string;
  command: string;
  hint: string;
}

/** The first batch from the plan: Codex CLI and Claude Code CLI. */
export const agentProviderDescriptors: AgentProviderDescriptor[] = [
  { id: 'codex', label: 'Codex CLI', command: 'codex', hint: 'OpenAI Codex 命令行' },
  { id: 'claude', label: 'Claude Code', command: 'claude', hint: 'Anthropic Claude Code 命令行' },
];

export function detectAgentCli(command: string) {
  return invoke<AgentCliStatus>('detect_agent_cli', { request: { command } });
}

export async function detectAgentProviders(descriptors = agentProviderDescriptors) {
  const statuses = await Promise.all(
    descriptors.map(async (descriptor) => {
      try {
        return [descriptor.id, await detectAgentCli(descriptor.command)] as const;
      } catch (error) {
        return [
          descriptor.id,
          {
            command: descriptor.command,
            available: false,
            executable_path: '',
            version: '',
            error: error instanceof Error ? error.message : String(error),
          },
        ] as const;
      }
    }),
  );
  return new Map<AgentProviderId, AgentCliStatus>(statuses);
}
