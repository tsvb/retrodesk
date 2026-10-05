import { open, type FileHandle } from 'fs/promises'
import { extname } from 'path'

/**
 * Best-effort system detection from disc image headers, used when neither the folder name nor the
 * extension identifies a system (.iso/.bin/.img/.chd/.cue in an unrecognised folder, or imported files).
 * Never throws; returns undefined when unsure.
 */

async function readAt(fh: FileHandle, pos: number, len: number): Promise<Buffer> {
  const buf = Buffer.alloc(len)
  const { bytesRead } = await fh.read(buf, 0, len, pos)
  return buf.subarray(0, bytesRead)
}

const ascii = (b: Buffer, start: number, len: number): string => b.toString('latin1', start, start + len)

interface IsoLayout {
  /** Bytes per raw sector (2048 for .iso, 2352 for raw bin). */
  sector: number
  /** Offset of user data inside a sector. */
  data: number
}

const LAYOUTS: IsoLayout[] = [
  { sector: 2048, data: 0 },
  { sector: 2352, data: 24 }, // mode 2 form 1 (PS1/PS2 CDs)
  { sector: 2352, data: 16 } // mode 1
]

async function readSectorData(fh: FileHandle, l: IsoLayout, lba: number, len: number): Promise<Buffer> {
  if (l.sector === 2048) return readAt(fh, lba * 2048, len)
  const parts: Buffer[] = []
  let remaining = len
  let s = lba
  while (remaining > 0) {
    const n = Math.min(2048, remaining)
    parts.push(await readAt(fh, s * l.sector + l.data, n))
    remaining -= n
    s++
  }
  return Buffer.concat(parts)
}

/** Read a file from the ISO9660 root directory by name (case-insensitive, ";1" ignored). */
async function readIsoRootFile(fh: FileHandle, l: IsoLayout, pvd: Buffer, name: string, max = 4096): Promise<Buffer | undefined> {
  const rootLba = pvd.readUInt32LE(156 + 2)
  const rootLen = Math.min(pvd.readUInt32LE(156 + 10), 64 * 1024)
  const dir = await readSectorData(fh, l, rootLba, rootLen)
  let i = 0
  while (i < dir.length) {
    const recLen = dir[i] ?? 0
    if (recLen === 0) {
      // Records don't cross sector boundaries: skip to the next 2048 block.
      i = (Math.floor(i / 2048) + 1) * 2048
      continue
    }
    if (i + 33 > dir.length) break
    const nameLen = dir[i + 32] ?? 0
    const fname = ascii(dir, i + 33, nameLen)
      .replace(/;\d+$/, '')
      .toUpperCase()
    if (fname === name.toUpperCase()) {
      const lba = dir.readUInt32LE(i + 2)
      const size = Math.min(dir.readUInt32LE(i + 10), max)
      return readSectorData(fh, l, lba, size)
    }
    i += recLen
  }
  return undefined
}

async function sniffIso(fh: FileHandle, size: number): Promise<string | undefined> {
  const head = await readAt(fh, 0, 64)
  // Nintendo optical discs (raw .iso/.gcm).
  if (head.length >= 0x20 && head.readUInt32BE(0x1c) === 0xc2339f3d) return 'gc'
  if (head.length >= 0x20 && head.readUInt32BE(0x18) === 0x5d1c9ea3) return 'wii'
  // Sega CD / Saturn system area at sector 0 (offset 0 for iso, 16 for raw mode-1 bin).
  for (const off of [0, 16]) {
    const b = off === 0 ? head : await readAt(fh, off, 32)
    const s = ascii(b, 0, 16)
    if (s.startsWith('SEGADISCSYSTEM') || s.startsWith('SEGA MEGA DRIVE')) return 'segacd'
    if (s.startsWith('SEGA SEGASATURN')) return 'saturn'
    if (s.startsWith('SEGA SEGAKATANA')) return 'dreamcast'
    if (b[0] === 0x01 && ascii(b, 1, 5) === 'ZZZZZ' && b[6] === 0x01) return '3do'
  }
  // Original Xbox XDVDFS (xiso at 0x10000, redump image after the video partition).
  for (const off of [0x10000, 0x18300000 + 0x10000]) {
    if (off + 20 > size) continue
    if (ascii(await readAt(fh, off, 20), 0, 20) === 'MICROSOFT*XBOX*MEDIA') return 'xbox'
  }
  // ISO9660 primary volume descriptor at LBA 16.
  for (const l of LAYOUTS) {
    const pvd = await readSectorData(fh, l, 16, 2048)
    if (pvd.length < 190 || pvd[0] !== 1 || ascii(pvd, 1, 5) !== 'CD001') continue
    const sysId = ascii(pvd, 8, 32).trim()
    if (sysId.startsWith('PSP GAME')) return 'psp'
    if (sysId.startsWith('PLAYSTATION')) {
      const cnf = await readIsoRootFile(fh, l, pvd, 'SYSTEM.CNF').catch(() => undefined)
      const text = cnf ? ascii(cnf, 0, cnf.length) : ''
      if (/^\s*BOOT2\s*=/m.test(text)) return 'ps2'
      if (/^\s*BOOT\s*=/m.test(text)) return 'psx'
      // No SYSTEM.CNF found: DVD-sized images are PS2, CD-sized ones PS1.
      return size > 900 * 1024 * 1024 ? 'ps2' : 'psx'
    }
    return undefined
  }
  return undefined
}

/** CHD v5: walk the metadata list. GD-ROM tracks ("CHGD") mean Dreamcast. */
async function sniffChd(fh: FileHandle): Promise<string | undefined> {
  const hdr = await readAt(fh, 0, 124)
  if (ascii(hdr, 0, 8) !== 'MComprHD' || hdr.length < 0x38) return undefined
  const version = hdr.readUInt32BE(12)
  if (version !== 5) return undefined
  let off = Number(hdr.readBigUInt64BE(0x30))
  for (let i = 0; off > 0 && i < 256; i++) {
    const e = await readAt(fh, off, 16)
    if (e.length < 16) break
    const tag = ascii(e, 0, 4)
    if (tag === 'CHGD') return 'dreamcast'
    off = Number(e.readBigUInt64BE(8))
  }
  return undefined
}

/**
 * Guess the system of a disc image. `candidates` restricts the answer (e.g. the systems that accept the
 * file's extension); pass an empty list to accept any result.
 */
export async function sniffSystem(path: string, candidates: readonly string[] = []): Promise<string | undefined> {
  const ext = extname(path).toLowerCase()
  if (!['.iso', '.bin', '.img', '.chd', '.gcm'].includes(ext)) return undefined
  let fh: FileHandle | undefined
  try {
    fh = await open(path, 'r')
    const { size } = await fh.stat()
    const id = ext === '.chd' ? await sniffChd(fh) : await sniffIso(fh, size)
    if (!id) return undefined
    return candidates.length === 0 || candidates.includes(id) ? id : undefined
  } catch {
    return undefined
  } finally {
    await fh?.close().catch(() => undefined)
  }
}

/** True if the start of the file looks like plain text (used to reject README.md and friends). */
export async function looksLikeText(path: string): Promise<boolean> {
  let fh: FileHandle | undefined
  try {
    fh = await open(path, 'r')
    const b = await readAt(fh, 0, 512)
    if (b.length === 0) return true
    for (const c of b) {
      if (c === 0) return false
      if (c < 9 || (c > 13 && c < 32)) return false
    }
    return true
  } catch {
    return false
  } finally {
    await fh?.close().catch(() => undefined)
  }
}
