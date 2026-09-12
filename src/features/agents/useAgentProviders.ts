import { useCallback, useRef, useState } from 'react';
import { agentProviderDescriptors, detectAgentProviders } from '../../platform/agentCli';
import { isTauriRuntime } from '../../platform/projects';
import type { AgentProviderId } from '../../core/workspace';

export interface AgentProviderState {
  id: AgentProviderId;
  label: string;
  command: string;
  hint: string;
  available: boolean;
  checked: boolean;
  version: string;
  executablePath: string;
  error: string;
}

const initialProviders = (): AgentProviderState[] =>
  agentProviderDescriptors.map((descriptor) => ({
    ...descriptor,
    available: false,
    checked: false,
    version: '',
    executablePath: '',
    error: '尚未检测 CLI，请点击重新检测。',
  }));

/** Detection only (CLI-0): says whether a CLI exists, never that it is running. */
export function useAgentProviders() {
  const [providers, setProviders] = useState<AgentProviderState[]>(initialProviders);
  const [loading, setLoading] = useState(false);

  const inFlight = useRef<Promise<void> | null>(null);
  // Explicit user action only. Merely mounting/restoring the workbench must
  // not spawn Codex/Claude version probes (including delayed timers).
  const refresh = useCallback(() => {
    if (!isTauriRuntime()) {
      setProviders(initialProviders);
      return Promise.resolve();
    }
    if (inFlight.current) return inFlight.current;
    setLoading(true);
    const request = detectAgentProviders()
      .then((statuses) => setProviders(agentProviderDescriptors.map((descriptor) => {
        const status = statuses.get(descriptor.id);
        return {
          ...descriptor,
          checked: true,
          available: status?.available ?? false,
          version: status?.version ?? '',
          executablePath: status?.executable_path ?? '',
          error: status?.error ?? '',
        };
      })))
      .catch((error) => setProviders(initialProviders().map((provider) => ({
        ...provider, checked: true, error: String(error),
      }))))
      .finally(() => { inFlight.current = null; setLoading(false); });
    inFlight.current = request;
    return request;
  }, []);

  return { providers, loading, refresh };
}
