// Nintendo Switch packages: telling a game apart from the updates and DLC that ship as separate .nsp files.
// A title ID's low 12 bits say what it is: 000 is the application itself, 800 its update, anything else DLC.
import { open } from 'fs/promises'
import { extname } from 'path'
import type { GameKind } from '../../shared/types'

/** What a Switch title ID denotes; undefined for a base game. */
export function titleIdKind(titleId: string): GameKind | undefined {
  const low = titleId.slice(-3).toLowerCase()
  if (low === '000') return undefined
  return low === '800' ? 'update' : 'dlc'
}

/** The largest PFS0 header we bother reading (16 bytes + 24 per entry + names). */
const MAX_HEADER = 64 * 1024

/**
 * File names inside an .nsp (a PFS0 archive); [] when the file is not one or cannot be read. The header is
 * plain, so this needs no keys.
 */
export async function pfs0Names(path: string): Promise<string[]> {
  let fh
  try {
    fh = await open(path, 'r')
  } catch {
    return []
  }
  try {
    const head = Buffer.alloc(16)
    if ((await fh.read(head, 0, 16, 0)).bytesRead < 16 || head.toString('latin1', 0, 4) !== 'PFS0') return []
    const count = head.readUInt32LE(4)
    const namesSize = head.readUInt32LE(8)
    const total = 16 + count * 24 + namesSize
    if (count === 0 || count > 4096 || total > MAX_HEADER) return []
    const buf = Buffer.alloc(total)
    if ((await fh.read(buf, 0, total, 0)).bytesRead < total) return []
    const names = buf.subarray(16 + count * 24)
    const out: string[] = []
    for (let i = 0; i < count; i++) {
      const at = buf.readUInt32LE(16 + i * 24 + 16)
      if (at >= names.length) continue
      const end = names.indexOf(0, at)
      out.push(names.toString('utf8', at, end === -1 ? names.length : end))
    }
    return out
  } catch {
    return []
  } finally {
    await fh.close().catch(() => undefined)
  }
}

const TICKET_RE = /^([0-9a-f]{16})[0-9a-f]{16}\.tik$/i
const NAME_ID_RE = /\[([0-9a-f]{16})\]/i

/**
 * Whether a Switch file is a game, an update or DLC. An .nsp carries a ticket named after its rights ID, whose
 * first 16 hex digits are the title ID; failing that the [title ID] scene releases put in the file name is used.
 * Cartridge dumps (.xci) are always the game itself.
 */
export async function switchContentKind(path: string, rawName: string): Promise<GameKind | undefined> {
  if (extname(path).toLowerCase() !== '.nsp') return undefined
  for (const n of await pfs0Names(path)) {
    const m = TICKET_RE.exec(n)
    if (m) return titleIdKind(m[1]!)
  }
  const m = NAME_ID_RE.exec(rawName)
  return m ? titleIdKind(m[1]!) : undefined
}
