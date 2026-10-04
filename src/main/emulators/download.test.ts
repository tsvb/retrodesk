import { createHash } from 'crypto'
import { createServer, type Server } from 'http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import standaloneEmulators from '../data/standalone-emulators.json'
import {
  clearRetroArchVersionMemo,
  downloadFile,
  downloadTrusted,
  fetchJsonCached,
  fetchText,
  HttpError,
  isTrustedDownloadUrl,
  parseBuildbotStableListing,
  parseDolphinUpdate,
  pickAsset,
  RateLimitError,
  RETROARCH_FALLBACK_VERSION,
  retroArchLatestStable,
  semverCompare,
  tagToVersion,
  UntrustedDownloadError,
  verifyDownload
} from './download'
import { createLimiter } from './limit'

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
  const body2 = Buffer.alloc(200 * 1024, 9)
  let seen: { url?: string; range?: string; ifRange?: string }[] = []
  let apiMode: 'ok' | 'limited' = 'ok'
  const apiRequests: (string | undefined)[] = []
  const dir = mkdtempSync(join(tmpdir(), 'rd-dl-'))
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

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
      // First request: half the file, then the connection drops. Retries ask for the rest.
      if (req.url === '/resumable' || req.url === '/changed') {
        const etag = req.url === '/changed' && seen.length ? '"v2"' : '"v1"'
        const content = etag === '"v2"' ? body2 : body
        seen.push({ url: req.url, range: req.headers.range, ifRange: req.headers['if-range'] as string | undefined })
        const start = Number(/^bytes=(\d+)-$/.exec(req.headers.range ?? '')?.[1] ?? NaN)
        if (req.headers.range && req.headers['if-range'] === etag && start < content.length) {
          res.writeHead(206, { ETag: etag, 'Content-Length': content.length - start, 'Content-Range': `bytes ${start}-${content.length - 1}/${content.length}` })
          return res.end(content.subarray(start))
        }
        res.writeHead(200, { ETag: etag, 'Content-Length': content.length })
        if (seen.length > 1) return res.end(content)
        res.write(content.subarray(0, content.length / 2))
        return setTimeout(() => res.destroy(), 50)
      }
      // Promises 10 bytes more than it sends; the resumed request then finds nothing left (416).
      if (req.url === '/short') {
        seen.push({ url: req.url, range: req.headers.range })
        if (req.headers.range) {
          res.writeHead(416, { 'Content-Range': `bytes */${body.length}` })
          return res.end()
        }
        res.writeHead(200, { 'Last-Modified': new Date(0).toUTCString(), 'Content-Length': body.length + 10 })
        res.write(body)
        return setTimeout(() => res.destroy(), 50)
      }
      if (req.url === '/api') {
        apiRequests.push(req.headers['if-none-match'] as string | undefined)
        if (apiMode === 'limited') {
          res.writeHead(403, { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 600) })
          return res.end('{"message":"API rate limit exceeded"}')
        }
        if (req.headers['if-none-match'] === '"r1"') {
          res.writeHead(304, { ETag: '"r1"' })
          return res.end()
        }
        res.writeHead(200, { ETag: '"r1"', 'Content-Type': 'application/json' })
        return res.end('{"tag_name":"v1.2.3"}')
      }
      if (req.url === '/hang') return // never answers
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

  it('hashes while streaming and returns the server validators', async () => {
    const r = await downloadFile(`${base}/file`, join(dir, 'j.bin'))
    expect(r.sha256).toBe(sha(body))
    const r2 = await downloadFile(`${base}/short`, join(dir, 'j2.bin'), { retries: 1 }).catch((e: Error) => e)
    expect(r2).toBeInstanceOf(Error) // one attempt: the missing 10 bytes are an error, and nothing is kept
    expect(existsSync(join(dir, 'j2.bin.part'))).toBe(false)
  })

  it('resumes an interrupted download with Range + If-Range', async () => {
    seen = []
    const dest = join(dir, 'k.bin')
    const progress: [number, number][] = []
    const r = await downloadFile(`${base}/resumable`, dest, { retries: 3, onProgress: (got, total) => progress.push([got, total]) })
    expect(readFileSync(dest).equals(body)).toBe(true)
    expect(r).toMatchObject({ bytes: body.length, sha256: sha(body), etag: '"v1"' })
    expect(seen).toHaveLength(2)
    expect(seen[0]!.range).toBeUndefined()
    const start = Number(/^bytes=(\d+)-$/.exec(seen[1]!.range ?? '')?.[1])
    expect(start).toBeGreaterThan(0)
    expect(seen[1]!.ifRange).toBe('"v1"')
    // Progress carries on from where the first attempt stopped, against the full size.
    expect(progress.find(([got]) => got === start)?.[1]).toBe(body.length)
    expect(progress.at(-1)).toEqual([body.length, body.length])
  })

  it('starts over when the file changed between attempts', async () => {
    seen = []
    const dest = join(dir, 'l.bin')
    const r = await downloadFile(`${base}/changed`, dest, { retries: 3 })
    expect(seen[1]!.ifRange).toBe('"v1"')
    expect(readFileSync(dest).equals(body2)).toBe(true)
    expect(r.sha256).toBe(sha(body2))
  })

  it('treats 416 on resume as "already complete" when the sizes agree', async () => {
    seen = []
    const dest = join(dir, 'm.bin')
    const r = await downloadFile(`${base}/short`, dest, { retries: 3 })
    expect(seen.map((s) => s.range)).toEqual([undefined, `bytes=${body.length}-`])
    expect(readFileSync(dest).equals(body)).toBe(true)
    expect(r.sha256).toBe(sha(body))
  })

  it('gives up on a metadata request that does not answer', async () => {
    const t = Date.now()
    await expect(fetchText(`${base}/hang`, { timeoutMs: 200, retries: 2 })).rejects.toThrow()
    expect(Date.now() - t).toBeLessThan(3000)
  })

  it('caches JSON on disk, revalidates with If-None-Match and falls back to the cache when rate-limited', async () => {
    const cacheDir = join(dir, 'cache')
    apiMode = 'ok'
    apiRequests.length = 0
    const url = `${base}/api`
    expect(await fetchJsonCached(url, { cacheDir })).toEqual({ tag_name: 'v1.2.3' })
    expect(await fetchJsonCached(url, { cacheDir })).toEqual({ tag_name: 'v1.2.3' }) // fresh: no request
    expect(apiRequests).toEqual([undefined])
    expect(await fetchJsonCached(url, { cacheDir, maxAgeMs: 0 })).toEqual({ tag_name: 'v1.2.3' }) // 304
    expect(apiRequests).toEqual([undefined, '"r1"'])

    apiMode = 'limited'
    expect(await fetchJsonCached(url, { cacheDir, maxAgeMs: 0 })).toEqual({ tag_name: 'v1.2.3' })
    expect(apiRequests).toHaveLength(3) // a rate limit is not retried
    const err = await fetchJsonCached(url, { cacheDir: join(dir, 'empty-cache') }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitError)
    expect((err as RateLimitError).resetAt?.getTime()).toBeGreaterThan(Date.now())
    expect((err as Error).message).toMatch(/rate limiting.*Try again after/)
    apiMode = 'ok'
  })
})

describe('download slots', () => {
  it('limits concurrency and lets queued work be cancelled', async () => {
    const limit = createLimiter(2)
    let running = 0
    let peak = 0
    const job = () =>
      limit(async () => {
        peak = Math.max(peak, ++running)
        await new Promise((r) => setTimeout(r, 20))
        running--
      })
    await Promise.all([job(), job(), job(), job(), job()])
    expect(peak).toBe(2)

    const ctrl = new AbortController()
    let queued = false
    const blockers = [job(), job()]
    const waiting = limit(async () => 'late', { signal: ctrl.signal, onQueued: () => (queued = true) })
    expect(queued).toBe(true)
    expect(limit.waiting).toBe(1)
    ctrl.abort()
    await expect(waiting).rejects.toThrow()
    await Promise.all(blockers)
    expect(limit.active).toBe(0)
    expect(limit.waiting).toBe(0)
  })
})

describe('retroArchLatestStable', () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'rd-ra-'))
  afterAll(() => {
    vi.unstubAllGlobals()
    rmSync(cacheDir, { recursive: true, force: true })
  })
  const stub = (handlers: { buildbot: () => Promise<Response>; github: () => Promise<Response> }) => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      const which = url.includes('buildbot') ? 'buildbot' : 'github'
      calls.push(which)
      return handlers[which]()
    })
    clearRetroArchVersionMemo()
    return calls
  }

  it('uses the buildbot when it answers, without asking GitHub', async () => {
    const calls = stub({ buildbot: async () => new Response(LISTING), github: async () => new Response('{"tag_name":"v9.9.9"}') })
    expect(await retroArchLatestStable()).toBe('1.22.2')
    await new Promise((r) => setTimeout(r, 50))
    expect(calls).toEqual(['buildbot'])
  })

  it('asks GitHub straight away when the buildbot fails, and remembers the answer', async () => {
    const calls = stub({ buildbot: async () => Promise.reject(new TypeError('fetch failed')), github: async () => new Response('{"tag_name":"v1.23.0"}') })
    const t = Date.now()
    expect(await retroArchLatestStable(undefined, cacheDir)).toBe('1.23.0')
    expect(Date.now() - t).toBeLessThan(1500)
    expect(calls.filter((c) => c === 'github')).toHaveLength(1)
    // Remembered in memory, and on disk for the next session.
    expect(await retroArchLatestStable(undefined, cacheDir)).toBe('1.23.0')
    clearRetroArchVersionMemo()
    expect(await retroArchLatestStable(undefined, cacheDir)).toBe('1.23.0')
    expect(calls.filter((c) => c === 'github')).toHaveLength(1)
  })

  it('falls back to the pinned version when nothing answers', async () => {
    stub({ buildbot: async () => new Response('', { status: 404 }), github: async () => new Response('', { status: 404 }) })
    expect(await retroArchLatestStable()).toBe(RETROARCH_FALLBACK_VERSION)
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

  it('gives every emulator a pinned fallback that its asset pattern accepts (installs survive a GitHub rate limit)', () => {
    for (const def of standaloneEmulators) {
      expect(def.fallback, def.id).toBeTruthy()
      expect(new RegExp(def.assetPattern).test(def.fallback!.url.split('/').pop()!), def.id).toBe(true)
    }
  })
})
