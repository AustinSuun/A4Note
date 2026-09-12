/**
 * Framework-free helpers for binding plugin-owned UI contributions.
 *
 * The React host uses these rules when a persisted workbench is restored
 * before the corresponding plugin lifecycle event has been observed. Keeping
 * the selection logic here makes the ownership and fallback contract testable
 * without importing React or feature modules.
 */
export interface PluginContributionIdentity {
  id: string;
  sceneId: string;
  pluginId: string;
}

export type PluginContributionKey = 'id' | 'sceneId';

/** Return only candidates owned by the same active plugin identity. */
export function findOwnedPluginCandidate<T extends PluginContributionIdentity>(
  registration: PluginContributionIdentity,
  candidates: readonly T[],
  isPluginActive: (pluginId: string) => boolean,
) {
  if (!isPluginActive(registration.pluginId)) return undefined;
  return candidates.find((candidate) =>
    isPluginActive(candidate.pluginId)
    && candidate.id === registration.id
    && candidate.sceneId === registration.sceneId
    && candidate.pluginId === registration.pluginId,
  );
}

/**
 * Select active candidates only when no active registration claims their key.
 * This is intentionally conservative: an active registration with a mismatched
 * owner remains a diagnostic instead of being silently crossed by another
 * plugin's adapter.
 */
export function selectPluginLifecycleFallbacks<T extends PluginContributionIdentity>(
  registrations: readonly PluginContributionIdentity[],
  resolved: readonly T[],
  candidates: readonly T[],
  isPluginActive: (pluginId: string) => boolean,
  key: PluginContributionKey,
) {
  const activeRegistrationKeys = new Set(
    registrations
      .filter((registration) => isPluginActive(registration.pluginId))
      .map((registration) => registration[key]),
  );
  const resolvedKeys = new Set(resolved.map((candidate) => candidate[key]));
  return candidates.filter((candidate) =>
    isPluginActive(candidate.pluginId)
    && !activeRegistrationKeys.has(candidate[key])
    && !resolvedKeys.has(candidate[key]),
  );
}
