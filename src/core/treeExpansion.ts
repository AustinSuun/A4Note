/** Keep descendant expansion choices when a parent closes. Disk trees may supply
 * path normalization; category IDs stay exact. Protected editor ancestors stay open. */
export function toggleTreeExpansion(expanded: readonly string[], id: string, normalize: (id: string) => string = value => value, protectedIds: readonly string[] = []): string[] {
  if (protectedIds.some(value => normalize(value) === normalize(id))) return [...expanded];
  const found = expanded.some(value => normalize(value) === normalize(id));
  return found ? expanded.filter(value => normalize(value) !== normalize(id)) : [...expanded, id];
}
