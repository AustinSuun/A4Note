import { invoke } from '@tauri-apps/api/core';

export interface SandboxCapabilities { available: boolean; backend: string; reason: string }
export interface PluginProcessResult { status: number; stdout: string; stderr: string }

export function getPluginSandboxCapabilities() {
  return invoke<SandboxCapabilities>('capabilities');
}

export function runPluginSandboxed(request: { cwd: string; program: string; args?: string[]; permissionMode: string }) {
  return invoke<PluginProcessResult>('run', { request });
}
