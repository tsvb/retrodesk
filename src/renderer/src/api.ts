import type { RetroDeskApi } from '@shared/api'
import { createMockApi } from './lib/mock/mockApi'

/** True when running inside Electron with the real preload bridge. */
export const isElectron = typeof window !== 'undefined' && typeof window.retrodesk === 'object' && window.retrodesk !== null

/**
 * The single entry point to the backend. Inside Electron this is the preload bridge; in a plain browser
 * (vite preview / design work) it is a realistic in-memory mock implementing the full API.
 */
export const api: RetroDeskApi = isElectron ? window.retrodesk : createMockApi()

/** Resolve a dropped File to an absolute path (Electron only). */
export function pathForFile(file: File): string | null {
  try {
    if (typeof window.retrodeskFiles?.pathFor === 'function') return window.retrodeskFiles.pathFor(file) || null
  } catch {
    /* not available */
  }
  return isElectron ? null : `C:\\Users\\you\\Downloads\\${file.name}`
}
