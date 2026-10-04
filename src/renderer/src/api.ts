import type { RetroDeskApi } from '@shared/api'
import { createMockApi } from './lib/mock/mockApi'

/** True when running inside Electron with the real preload bridge. */
export const isElectron = typeof window !== 'undefined' && typeof window.retrodesk === 'object' && window.retrodesk !== null

/**
 * True in a production bundle that has no preload bridge. That is a broken install: main.tsx shows an error
 * instead of the app, rather than quietly running on sample data.
 */
export const bridgeMissing = !isElectron && !import.meta.env.DEV

/** Stand-in for the API when the bridge is missing: every call throws a clear error. */
function missingBridge(): RetroDeskApi {
  const fail = (): never => {
    throw new Error('The RetroDesk preload bridge is missing')
  }
  return new Proxy({}, { get: () => new Proxy(fail, { get: () => fail }) }) as RetroDeskApi
}

/**
 * The single entry point to the backend. Inside Electron this is the preload bridge; on the dev server in a
 * plain browser (design work) it is a realistic in-memory mock implementing the full API. The mock is dev-only:
 * `import.meta.env.DEV` is false in a production build, which also lets the bundler drop it.
 */
export const api: RetroDeskApi = isElectron ? window.retrodesk : import.meta.env.DEV ? createMockApi() : missingBridge()

/** Resolve a dropped File to an absolute path (Electron only). */
export function pathForFile(file: File): string | null {
  try {
    if (typeof window.retrodeskFiles?.pathFor === 'function') return window.retrodeskFiles.pathFor(file) || null
  } catch {
    /* not available */
  }
  return isElectron ? null : `C:\\Users\\you\\Downloads\\${file.name}`
}
