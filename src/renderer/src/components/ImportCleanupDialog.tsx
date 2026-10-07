import { api } from '../api'
import { plural } from '../lib/format'
import { toast } from '../stores/session'
import { useImportCleanup } from '../stores/importCleanup'
import { ConfirmDialog } from './Modal'

const parentOf = (p: string): string => p.replace(/[\\/][^\\/]+$/, '')

/** Offers to move the originals of the last import to the Trash, since the copies in the data folder are what the library uses now. */
export function ImportCleanupDialog() {
  const pending = useImportCleanup((s) => s.pending)
  const dismiss = useImportCleanup((s) => s.dismiss)
  if (!pending) return null
  const { originals } = pending
  const folders = [...new Set(originals.map(parentOf))]
  const where = folders.length === 1 ? folders[0] : `${folders.length} folders`
  return (
    <ConfirmDialog
      title="Remove the originals?"
      description={`${plural(originals.length, 'file or folder', 'files and folders')} in ${where} ${originals.length === 1 ? 'is' : 'are'} now also in your data folder, which is where the library plays ${originals.length === 1 ? 'it' : 'them'} from. Move the originals to the Trash? You can take them back out of the Trash if you change your mind.`}
      confirmLabel="Move to Trash"
      danger
      onCancel={dismiss}
      onConfirm={async () => {
        dismiss()
        try {
          const r = await api.library.removeImportedOriginals(originals)
          if (r.errors.length) console.warn('[import] could not remove', r.errors)
          toast(
            r.removed ? `Moved ${plural(r.removed, 'item')} to the Trash${r.errors.length ? `, ${r.errors.length} could not be moved` : ''}` : 'Nothing could be moved to the Trash',
            r.errors.length ? 'error' : 'success'
          )
        } catch (e) {
          toast(`Couldn't remove the originals: ${e instanceof Error ? e.message : String(e)}`, 'error')
        }
      }}
    />
  )
}
