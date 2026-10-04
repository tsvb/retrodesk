import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'

/** Test helpers (not used by production code). */

export function writeFile(p: string, data: string | Buffer): void {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, data)
}

/** Non-text binary blob of `size` bytes. */
export function rom(size = 2048, seed = 1): Buffer {
  const b = Buffer.alloc(size)
  let x = seed * 2654435761
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) >>> 0
    b[i] = x & 0xff
  }
  b[0] = 0
  return b
}

/** Minimal PARAM.SFO with UTF-8 string fields. */
export function buildSfo(fields: Record<string, string>): Buffer {
  const keys = Object.keys(fields)
  const keyTable = Buffer.concat(keys.map((k) => Buffer.from(`${k}\0`, 'utf8')))
  const datas = keys.map((k) => Buffer.from(`${fields[k]}\0`, 'utf8'))
  const headerLen = 20 + keys.length * 16
  const keyStart = headerLen
  const dataStart = keyStart + keyTable.length + ((4 - (keyTable.length % 4)) % 4)
  const index = Buffer.alloc(keys.length * 16)
  let kOff = 0
  let dOff = 0
  keys.forEach((k, i) => {
    const d = datas[i] as Buffer
    index.writeUInt16LE(kOff, i * 16)
    index.writeUInt16LE(0x0204, i * 16 + 2)
    index.writeUInt32LE(d.length, i * 16 + 4)
    index.writeUInt32LE(d.length, i * 16 + 8)
    index.writeUInt32LE(dOff, i * 16 + 12)
    kOff += Buffer.byteLength(k) + 1
    dOff += d.length
  })
  const header = Buffer.alloc(20)
  header.writeUInt32BE(0x00505346, 0)
  header.writeUInt32LE(0x0101, 4)
  header.writeUInt32LE(keyStart, 8)
  header.writeUInt32LE(dataStart, 12)
  header.writeUInt32LE(keys.length, 16)
  const pad = Buffer.alloc(dataStart - keyStart - keyTable.length)
  return Buffer.concat([header, index, keyTable, pad, ...datas])
}

/** 2048-byte-sector ISO with a primary volume descriptor whose system id is `systemId`. */
export function fakeIso(systemId: string, extraSectors = 2): Buffer {
  const b = Buffer.alloc(2048 * (17 + extraSectors))
  const pvd = 16 * 2048
  b[pvd] = 1
  b.write('CD001', pvd + 1, 'latin1')
  b.write(systemId.padEnd(32, ' '), pvd + 8, 'latin1')
  return b
}

export function fakeGameCubeIso(): Buffer {
  const b = rom(4096)
  b.writeUInt32BE(0xc2339f3d, 0x1c)
  return b
}
