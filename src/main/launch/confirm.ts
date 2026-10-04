// RetroArch's network commands are fire-and-forget UDP: nothing comes back to say a state or screenshot was
// written. The file it leaves behind is the only receipt, so wait for that.
import { readdir, stat } from 'fs/promises'
import { join } from 'path'

/** Clock slack between Date.now() and file-system timestamps. */
const MTIME_SLACK_MS = 1000

/** Resolves true once a file matching `name` in `dir` has been written at or after `since`, false on timeout. */
export async function fileWrittenSince(dir: string, since: number, name: RegExp = /./, timeoutMs = 3000, intervalMs = 100): Promise<boolean> {
  const end = Date.now() + timeoutMs
  for (;;) {
    for (const f of await readdir(dir).catch(() => [] as string[])) {
      if (!name.test(f)) continue
      const st = await stat(join(dir, f)).catch(() => null)
      if (st?.isFile() && st.mtimeMs >= since - MTIME_SLACK_MS) return true
    }
    if (Date.now() >= end) return false
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
