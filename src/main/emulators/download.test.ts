import { createHash } from 'crypto'
import { createServer, type Server } from 'http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import standaloneEmulators from '../data/standalone-emulators.json'
import {
  downloadFile,
  downloadTrusted,
  HttpError,
  isTrustedDownloadUrl,
  parseBuildbotStableListing,
  parseDolphinUpdate,
  pickAsset,
  semverCompare,
  tagToVersion,
  UntrustedDownloadError,
  verifyDownload
} from './download'

const LISTING = `<html><body><table>
<tr><td><a href="/stable/1.10.0/">1.10.0/</a></td></tr>
<tr><td><a href="/stable/1.21.0/">1.21.0/</a></td></tr>
<tr><td><a href="/stable/1.22.2/">1.22.2/</a></td></tr>
<tr><td><a href="/stable/1.22.0/">1.22.0/</a></td></tr>
<tr><td><a href="/stable/1.9.9/">1.9.9/</a></td></tr>
<tr><td><a href="/stable/1.7.5/">1.7.5/</a></td></tr>
</table></body></html>`

describe('release discovery parsing', () => {
  it('semver-sorts the buildbot listing (lexical order would pick 1.9.9)', () => {
    expect(parseBuildbotStableListing(LISTING)).toBe('1.22.2')
    expect(parseBuildbotStableListing('<a href="1.2.3/">')).toBe('1.2.3')
    expect(parseBuildbotStableListing('nothing')).toBeUndefined()
  })

  it('compares versions numerically', () => {
    expect(semverCompare('1.9.9', '1.10.0')).toBe(-1)
    expect(semverCompare('1.22.2', '1.22.2')).toBe(0)
    expect(semverCompare('2.0', '1.99.99')).toBe(1)
  })

  it('handles tags and assets', () => {
    expect(tagToVersion('v1.20.4')).toBe('1.20.4')
    expect(tagToVersion('2126.1.2')).toBe('2126.1.2')
    const assets = [
      { name: 'pcsx2-v2.8.2-windows-x64-Qt-symbols.7z', url: 'a' },
      { name: 'pcsx2-v2.8.2-windows-x64-Qt.7z', url: 'b' }
    ]
    expect(pickAsset(assets, /^pcsx2-v[\d.]+-windows-x64-Qt\.7z$/)?.url).toBe('b')
  })

  it('reads the Dolphin update feed', () => {
    const r = parseDolphinUpdate({
      shortrev: '2609',
      artifacts: [
        { system: 'Android', url: 'https://dl.dolphin-emu.org/releases/2609/dolphin-2609.apk' },
        { system: 'Windows x64', url: 'https://dl.dolphin-emu.org/releases/2609/dolphin-2609-x64.7z' }
      ]
    })
    expect(r).toEqual({ version: '2609', asset: { name: 'dolphin-2609-x64.7z', url: 'https://dl.dolphin-emu.org/releases/2609/dolphin-2609-x64.7z' } })
  })
})

describe('downloadFile', () => {
  let server: Server
  let base = ''
  let flaky = 0
  const body = Buffer.alloc(256 * 1024, 7)
  const dir = mkdtempSync(join(tmpdir(), 'rd-dl-'))

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/file' })
        return res.end()
      }
      if (req.url === '/file') {
        res.writeHead(200, { 'Content-Length': body.length })
        return res.end(body)
      }
      if (req.url === '/flaky') {
        if (flaky++ < 2) {
          res.writeHead(503)
          return res.end()
        }
        res.writeHead(200, { 'Content-Length': body.length })
        return res.end(body)
      }
      if (req.url === '/slow') {
        res.writeHead(200, { 'Content-Length': body.length })
        res.write(body.subarray(0, 1024))
        return // never finishes
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => {
    server.closeAllConnections()
    server.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('follows redirects, reports progress and renames the temp file', async () => {
    const dest = join(dir, 'a.bin')
    const seen: number[] = []
    const r = await downloadFile(`${base}/redirect`, dest, { onProgress: (got, total) => seen.push(total ? got / total : 0) })
    expect(r.bytes).toBe(body.length)
    expect(readFileSync(dest).equals(body)).toBe(true)
    expect(existsSync(`${dest}.part`)).toBe(false)
    expect(seen.at(-1)).toBe(1)
  })

  it('retries 5xx', async () => {
    const dest = join(dir, 'b.bin')
    await downloadFile(`${base}/flaky`, dest, { retries: 4 })
    expect(flaky).toBe(3)
    expect(readFileSync(dest).length).toBe(body.length)
  })

  it('does not retry 404 and leaves no temp file', async () => {
    const dest = join(dir, 'c.bin')
    await expect(downloadFile(`${base}/missing`, dest, { retries: 3 })).rejects.toBeInstanceOf(HttpError)
    expect(existsSync(dest) || existsSync(`${dest}.part`)).toBe(false)
  })

  it('is cancellable and cleans up', async () => {
    const dest = join(dir, 'd.bin')
    const ctrl = new AbortController()
    const p = downloadFile(`${base}/slow`, dest, { signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 150)
    await expect(p).rejects.toThrow()
    expect(existsSync(dest) || existsSync(`${dest}.part`)).toBe(false)
  })

  it('aborts stalled transfers', async () => {
    const dest = join(dir, 'e.bin')
    await expect(downloadFile(`${base}/slow`, dest, { retries: 1, stallTimeoutMs: 200 })).rejects.toThrow(/stalled/)
  })

  it('refuses plain HTTP when httpsOnly is set, without retrying', async () => {
    const dest = join(dir, 'f.bin')
    await expect(downloadFile(`${base}/file`, dest, { httpsOnly: true, retries: 3 })).rejects.toBeInstanceOf(UntrustedDownloadError)
    expect(existsSync(dest) || existsSync(`${dest}.part`)).toBe(false)
  })

  it('checks a finished download against the published size and SHA-256', async () => {
    const dest = join(dir, 'g.bin')
    await downloadFile(`${base}/file`, dest)
    const sha256 = createHash('sha256').update(body).digest('hex')
    await expect(verifyDownload(dest, { size: body.length, sha256: sha256.toUpperCase() })).resolves.toBeUndefined()
    await expect(verifyDownload(dest, {})).resolves.toBeUndefined()
    await expect(verifyDownload(dest, { size: body.length + 1 })).rejects.toBeInstanceOf(UntrustedDownloadError)
    await expect(verifyDownload(dest, { sha256: '0'.repeat(64) })).rejects.toBeInstanceOf(UntrustedDownloadError)
  })

  it('refuses untrusted locations before any request is made', async () => {
    await expect(downloadTrusted(`${base}/file`, join(dir, 'h.bin'))).rejects.toBeInstanceOf(UntrustedDownloadError)
    await expect(downloadTrusted('https://example.com/emulator.7z', join(dir, 'i.bin'))).rejects.toBeInstanceOf(UntrustedDownloadError)
  })
})

describe('isTrustedDownloadUrl', () => {
  it('accepts the hosts RetroDesk installs from, over HTTPS only', () => {
    expect(isTrustedDownloadUrl('https://buildbot.libretro.com/stable/1.22.2/windows/x86_64/RetroArch.7z')).toBe(true)
    expect(isTrustedDownloadUrl('https://github.com/PCSX2/pcsx2/releases/download/v2.8.2/pcsx2-v2.8.2-windows-x64-Qt.7z')).toBe(true)
    expect(isTrustedDownloadUrl('https://dl.dolphin-emu.org/releases/2609/dolphin-2609-x64.7z')).toBe(true)
    expect(isTrustedDownloadUrl('https://stable.eden-emu.dev/v0.2.1/Eden-Windows-v0.2.1-amd64-msvc-standard.zip')).toBe(true)
    expect(isTrustedDownloadUrl('http://github.com/PCSX2/pcsx2/releases/download/v2.8.2/x.7z')).toBe(false)
  })

  it('rejects other hosts, including look-alikes', () => {
    expect(isTrustedDownloadUrl('https://example.com/dolphin-2609-x64.7z')).toBe(false)
    expect(isTrustedDownloadUrl('https://github.com.evil.example/x.7z')).toBe(false)
    expect(isTrustedDownloadUrl('https://notgithub.com/x.7z')).toBe(false)
    expect(isTrustedDownloadUrl('file:///C:/x.7z')).toBe(false)
    expect(isTrustedDownloadUrl('not a url')).toBe(false)
  })

  it('covers every pinned fallback URL in the emulator catalogue', () => {
    for (const def of standaloneEmulators) {
      if (def.fallback) expect(isTrustedDownloadUrl(def.fallback.url), def.id).toBe(true)
    }
  })
})
