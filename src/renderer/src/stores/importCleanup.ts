import { create } from 'zustand'
import type { ImportResult } from '@shared/types'

/**
 * After an import copied games into the data folder, the originals are duplicates. This holds the offer to
 * remove them until the player answers (see ImportCleanupDialog); only one offer is shown at a time.
 */
interface ImportCleanupState {
  pending: ImportResult | null
  offer: (r: ImportResult) => void
  dismiss: () => void
}

export const useImportCleanup = create<ImportCleanupState>((set) => ({
  pending: null,
  offer: (r) => set({ pending: r.originals.length ? r : null }),
  dismiss: () => set({ pending: null })
}))
