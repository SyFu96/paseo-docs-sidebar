/**
 * A cheap content fingerprint for React Query keys. Derived Markdown work (math, sanitizing)
 * must refetch when the source text changes; keeping the full text in the key would retain every
 * version in the query cache, so store only the length and an FNV-1a hash.
 */
export function textKey(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}
