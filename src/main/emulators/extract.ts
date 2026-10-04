// Archive extraction via the bundled 7za.exe (handles .7z and .zip, including Azahar's backslash entry names)
// plus small filesystem helpers used by installers.
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, readdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import sevenBin from '7zip-bin'
import { createLimiter } from './limit'

/** 7za.exe path; inside a packaged app it lives in app.asar.unpacked (see electron-builder asarUnpack). */
export function sevenZipPath(): string {
  return sevenBin.path7za.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
}

/** Parse the last "NN%" token out of 7za -bsp1 output (which uses backspaces to redraw the line). */
export function parse7zProgress(chunk: string): number | undefined {
  const all = [...chunk.matchAll(/(\d{1,3})%/g)]
  const last = all.at(-1)
  if (!last) return undefined
  const n = Number(last[1])
  return n >= 0 && n <= 100 ? n / 100 : undefined
}

export interface ExtractOptions {
  onProgress?: (fraction: number) => void
  /** Called when the extraction has to wait for a free slot (see MAX_CONCURRENT_EXTRACTIONS). */
  onQueued?: () => void
  signal?: AbortSignal
}

/** 7za processes at once; extraction is disk-bound, so more in parallel only makes each one slower. */
export const MAX_CONCURRENT_EXTRACTIONS = 2
const extractSlots = createLimiter(MAX_CONCURRENT_EXTRACTIONS)

/** `7za x -y -bsp1 -o<dest> <archive>`. Resolves when done; rejects on fatal error or abort. */
export async function extractArchive(archive: string, dest: string, opts: ExtractOptions = {}): Promise<void> {
  await mkdir(dest, { recursive: true })
  await extractSlots(() => run7za(archive, dest, opts), { signal: opts.signal, onQueued: opts.onQueued }).catch((e: unknown) => {
    // Cancelled while queued: same error as cancelled while running.
    throw opts.signal?.aborted ? new Error('Extraction cancelled') : e
  })
  opts.onProgress?.(1)
}

function run7za(archive: string, dest: string, opts: ExtractOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Error('Extraction cancelled'))
    const child = spawn(sevenZipPath(), ['x', '-y', '-bsp1', '-bb0', `-o${dest}`, archive], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => {
      const p = parse7zProgress(d)
      if (p !== undefined) opts.onProgress?.(p)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d: string) => {
      stderr += d
    })
    const onAbort = () => child.kill()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (e) => {
      opts.signal?.removeEventListener('abort', onAbort)
      reject(e)
    })
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort)
      if (opts.signal?.aborted) return reject(new Error('Extraction cancelled'))
      // 0 = OK, 1 = warnings (e.g. a locked file), 2+ = fatal.
      if (code === 0 || code === 1) resolve()
      else reject(new Error(`7-Zip failed (exit ${code}): ${stderr.trim().split(/\r?\n/).slice(-3).join(' ') || 'unknown error'}`))
    })
  })
}

/** If `dir` contains exactly one entry and it is a directory, return that directory; else `dir`. */
export async function singleTopFolder(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  if (entries.length === 1 && entries[0]!.isDirectory()) return join(dir, entries[0]!.name)
  return dir
}

/**
 * Move everything from `src` into `dst`, merging directories and replacing files.
 * Uses rename (same volume) so installing a 200MB RetroArch is instant and existing user data
 * (cores/, saves, portable user dirs) that the archive doesn't contain is preserved.
 */
export async function moveMerge(src: string, dst: string): Promise<void> {
  await mkdir(dst, { recursive: true })
  for (const e of await readdir(src, { withFileTypes: true })) {
    const s = join(src, e.name)
    const d = join(dst, e.name)
    if (!existsSync(d)) {
      await rename(s, d)
    } else if (e.isDirectory() && (await stat(d)).isDirectory()) {
      await moveMerge(s, d)
    } else {
      await rm(d, { recursive: true, force: true })
      await rename(s, d)
    }
  }
}

/** Recursively delete `dir`'s contents except the given relative paths (top-level names, case-insensitive). */
export async function removeExcept(dir: string, keep: string[]): Promise<boolean> {
  if (!existsSync(dir)) return false
  const keepSet = new Set(keep.map((k) => k.replace(/[\\/]+$/, '').toLowerCase()))
  let kept = false
  for (const e of await readdir(dir)) {
    if (keepSet.has(e.toLowerCase())) {
      kept = true
      continue
    }
    await rm(join(dir, e), { recursive: true, force: true, maxRetries: 3 })
  }
  if (!kept) await rm(dir, { recursive: true, force: true, maxRetries: 3 })
  return kept
}

/**
 * Total size of the files below `p` (or of `p` itself). A RetroArch install has thousands of files, so entries
 * are read and stat'ed up to 32 at a time rather than one by one. Symlinks/junctions are not followed.
 */
export async function dirSize(p: string): Promise<number> {
  const st = await stat(p).catch(() => null)
  if (!st) return 0
  if (!st.isDirectory()) return st.size
  const io = createLimiter(32)
  const walk = async (dir: string): Promise<number> => {
    const entries = await io(() => readdir(dir, { withFileTypes: true })).catch(() => [])
    const sizes = await Promise.all(
      entries.map((e) => {
        const full = join(dir, e.name)
        if (e.isDirectory()) return walk(full)
        if (e.isFile()) return io(() => stat(full)).then((s) => s.size, () => 0)
        return 0
      })
    )
    return sizes.reduce((a, b) => a + b, 0)
  }
  return walk(p)
}

/** Breadth-first search for a file name (case-insensitive) below `root`, max `depth` levels. */
export async function findFile(root: string, name: string, depth = 3): Promise<string | undefined> {
  const target = name.toLowerCase()
  let level = [root]
  for (let d = 0; d <= depth && level.length; d++) {
    const next: string[] = []
    for (const dir of level) {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        if (e.isFile() && e.name.toLowerCase() === target) return join(dir, e.name)
        if (e.isDirectory()) next.push(join(dir, e.name))
      }
    }
    level = next
  }
  return undefined
}
