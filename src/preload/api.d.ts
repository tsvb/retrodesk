import type { RetroDeskApi } from '../shared/api'

declare global {
  interface Window {
    retrodesk: RetroDeskApi
    retrodeskFiles: { pathFor(file: File): string }
  }
}

export {}
