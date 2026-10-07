import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { pfs0Names, switchContentKind, titleIdKind } from './nsw'
import { writeFile } from './testutil'

const tmp = mkdtempSync(join(tmpdir(), 'rd-nsw-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

/** A PFS0 archive holding empty files with the given names. */
function pfs0(names: string[]): Buffer {
  const table = Buffer.concat(names.map((n) => Buffer.from(`${n}\0`)))
  const head = Buffer.alloc(16)
  head.write('PFS0', 0, 'latin1')
  head.writeUInt32LE(names.length, 4)
  head.writeUInt32LE(table.length, 8)
  const entries = Buffer.alloc(names.length * 24)
  let at = 0
  names.forEach((n, i) => {
    entries.writeUInt32LE(at, i * 24 + 16)
    at += n.length + 1
  })
  return Buffer.concat([head, entries, table])
}

describe('Switch packages', () => {
  it('tells games, updates and DLC apart by title ID', () => {
    expect(titleIdKind('0100152000022000')).toBeUndefined()
    expect(titleIdKind('0100152000022800')).toBe('update')
    expect(titleIdKind('0100152000023001')).toBe('dlc')
    expect(titleIdKind('010028600EBDA800')).toBe('update')
  })

  it('reads the file names out of an .nsp header without keys', async () => {
    const p = join(tmp, 'a.nsp')
    writeFile(p, pfs0(['1c0f7b5a2b3c4d5e6f708192a3b4c5d6.nca', '01001520000228000000000000000005.tik', '01001520000228000000000000000005.cert']))
    expect(await pfs0Names(p)).toEqual(['1c0f7b5a2b3c4d5e6f708192a3b4c5d6.nca', '01001520000228000000000000000005.tik', '01001520000228000000000000000005.cert'])
    writeFile(join(tmp, 'not.nsp'), 'hello')
    expect(await pfs0Names(join(tmp, 'not.nsp'))).toEqual([])
  })

  it('classifies by the ticket inside, then by the [title ID] in the name, and trusts cartridge dumps', async () => {
    const update = join(tmp, 'Mario Kart 8 Deluxe.nsp')
    writeFile(update, pfs0(['abc.nca', '01001520000228000000000000000005.tik']))
    expect(await switchContentKind(update, 'Mario Kart 8 Deluxe')).toBe('update')
    const base = join(tmp, 'base.nsp')
    writeFile(base, pfs0(['abc.nca', '01001520000220000000000000000005.tik']))
    expect(await switchContentKind(base, 'base [0100152000022800]')).toBeUndefined()
    const noTicket = join(tmp, 'dlc.nsp')
    writeFile(noTicket, pfs0(['abc.nca']))
    expect(await switchContentKind(noTicket, 'Mario Kart 8 Deluxe [Wave 1] [0100152000023001][v65536]')).toBe('dlc')
    expect(await switchContentKind(noTicket, 'Some Game')).toBeUndefined()
    expect(await switchContentKind(join(tmp, 'Game [0100152000022800].xci'), 'Game [0100152000022800]')).toBeUndefined()
  })
})
