import dgram from 'dgram'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseStatus, RaCommandClient } from './racommand'

describe('parseStatus', () => {
  it('parses playing/paused/contentless replies', () => {
    expect(parseStatus('GET_STATUS PLAYING super_nes,Super Mario World (USA),crc32=b19ed489\n')).toEqual({
      state: 'PLAYING',
      system: 'super_nes',
      content: 'Super Mario World (USA)',
      crc32: 'b19ed489'
    })
    expect(parseStatus('GET_STATUS PAUSED nes,Legend of Zelda, The (USA),crc32=3fe272fb')).toMatchObject({ state: 'PAUSED', content: 'Legend of Zelda, The (USA)' })
    expect(parseStatus('GET_STATUS CONTENTLESS')).toEqual({ state: 'CONTENTLESS' })
    expect(parseStatus('VERSION 1.22.2')).toBeUndefined()
  })
})

/** Minimal fake of RetroArch's UDP command interface. */
describe('RaCommandClient against a fake RetroArch', () => {
  const server = dgram.createSocket('udp4')
  const received: string[] = []
  let paused = false
  let client: RaCommandClient

  beforeAll(async () => {
    server.on('message', (msg, rinfo) => {
      const cmd = msg.toString()
      received.push(cmd)
      const reply = (s: string) => server.send(s, rinfo.port, rinfo.address)
      if (cmd === 'GET_STATUS') reply(`GET_STATUS ${paused ? 'PAUSED' : 'PLAYING'} super_nes,Test Game,crc32=deadbeef\n`)
      else if (cmd === 'VERSION') reply('1.22.2\n')
      else if (cmd === 'PAUSE_TOGGLE') paused = !paused
      // SAVE_STATE etc: no reply, like RetroArch
    })
    await new Promise<void>((r) => server.bind(0, '127.0.0.1', r))
    client = new RaCommandClient((server.address() as AddressInfo).port)
  })
  afterAll(() => {
    client.close()
    server.close()
  })

  it('round-trips GET_STATUS and VERSION', async () => {
    expect(await client.getStatus()).toEqual({ state: 'PLAYING', system: 'super_nes', content: 'Test Game', crc32: 'deadbeef' })
    expect(await client.version()).toBe('1.22.2')
  })

  it('sends fire-and-forget commands', async () => {
    await client.send('SAVE_STATE')
    await client.send('PAUSE_TOGGLE')
    expect((await client.getStatus())?.state).toBe('PAUSED')
    expect(received).toContain('SAVE_STATE')
  })

  it('matches concurrent replies by prefix', async () => {
    const [a, b] = await Promise.all([client.request('GET_STATUS'), client.version()])
    expect(a).toMatch(/^GET_STATUS PAUSED/)
    expect(b).toBe('1.22.2')
  })

  it('times out to null when nobody answers', async () => {
    const dead = new RaCommandClient(1)
    const t = Date.now()
    expect(await dead.getStatus(150)).toBeNull()
    expect(Date.now() - t).toBeLessThan(1000)
    dead.close()
  })
})
