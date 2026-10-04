/**
 * Deep-merge a settings patch into a base value. Plain objects merge key by key; arrays, primitives and null
 * replace. Record<string, x> maps (e.g. systemEmulator) are therefore replaced key-by-key.
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base
  if (Array.isArray(patch) || patch === null || typeof patch !== 'object' || typeof base !== 'object' || base === null || Array.isArray(base)) {
    return patch as T
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = deepMerge(out[k], v)
  return out as T
}
