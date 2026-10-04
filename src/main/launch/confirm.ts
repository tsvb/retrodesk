// RetroArch's network commands are fire-and-forget UDP: nothing comes back to say a state or screenshot was
// written. The file it leaves behind is the only receipt, so wait for that.
import { watch, type FSWatcher } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'

/** Clock slack between Date.now() and file-system timestamps. */
const MTIME_SLACK_MS = 1000

async function writtenSince(file: string, since: number): Promise<boolean> {
  const st = await stat(file).catch(() => null)
  return !!st?.isFile() && st.mtimeMs >= since - MTIME_SLACK_MS
}

/** One look at every file matching `name`. */
async function scan(dir: string, since: number, name: RegExp): Promise<boolean> {
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    if (name.test(f) && (await writtenSince(join(dir, f), since))) return true
  }
  return false
}

/**
 * Resolves true once a file matching `name` in `dir` has been written at or after `since`, false on timeout.
 * The folder is watched, so only files that change are looked at; it is scanned once up front (the write may
 * already have happened) and once at the end (in case a change notification was missed). If the folder can't
 * be watched it is polled every `intervalMs` instead.
 */
export async function fileWrittenSince(dir: string, since: number, name: RegExp = /./, timeoutMs = 3000, intervalMs = 100): Promise<boolean> {
  let watcher: FSWatcher | undefined
  let found!: (v: boolean) => void
  const result = new Promise<boolean>((r) => (found = r))
  try {
    watcher = watch(dir, { persistent: false }, (_event, file) => {
      // Windows sometimes reports a change without a name: look at everything then.
      const f = file?.toString()
      if (!f) void scan(dir, since, name).then((ok) => ok && found(true))
      else if (name.test(f)) void writtenSince(join(dir, f), since).then((ok) => ok && found(true))
    })
    watcher.on('error', () => undefined)
  } catch {
    watcher = undefined
  }
  if (!watcher) return poll(dir, since, name, timeoutMs, intervalMs)
  const timer = setTimeout(() => void scan(dir, since, name).then(found), timeoutMs)
  void scan(dir, since, name).then((ok) => ok && found(true))
  try {
    return await result
  } finally {
    clearTimeout(timer)
    watcher.close()
  }
}

async function poll(dir: string, since: number, name: RegExp, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs
  for (;;) {
    if (await scan(dir, since, name)) return true
    if (Date.now() >= end) return false
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
