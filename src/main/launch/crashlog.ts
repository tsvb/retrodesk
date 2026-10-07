// Some emulators keep running after the game inside them has died: Eden logs "Emulated program broke
// execution" and then sits on its loading screen. Following the emulator's log while a session runs lets
// RetroDesk tell the player instead of leaving them to wonder.
import { open, stat } from 'fs/promises'

export interface CrashLogWatch {
  /** The emulator's log file. */
  file: string
  /** Substrings that mark a fatal problem; the first line containing one ends the watch. */
  patterns: string[]
  /** Only lines written to a file modified at or after this time count (the previous run's log is ignored). */
  since: number
  onMatch: (line: string) => void
  intervalMs?: number
}

export interface CrashLogWatcher {
  /** End the watch. */
  stop(): void
  /**
   * Read whatever the log gained since the last poll, right now. For the emulator that dies a moment after
   * writing the fatal line, the exit handler calls this before stopping. True when a match was reported.
   */
  check(): Promise<boolean>
}

/** Max bytes read per poll: a flood of log output is sampled rather than read in full. */
const CHUNK = 512 * 1024

/**
 * Poll `file` for new lines containing one of `patterns`; `onMatch` fires once, then the watch ends. The log is
 * read from the start once the emulator has replaced it (Eden rotates the previous run's log on start-up), and
 * from wherever reading left off after that.
 */
export function watchCrashLog(w: CrashLogWatch): CrashLogWatcher {
  let inode = -1
  let offset = 0
  let rest = ''
  let done = false
  let matched = false
  let reading: Promise<void> = Promise.resolve()
  const needles = w.patterns.filter(Boolean)
  const poll = async (): Promise<void> => {
    if (done || !needles.length) return
    let st
    try {
      st = await stat(w.file)
    } catch {
      return // not written yet
    }
    if (st.mtimeMs < w.since) return // the previous run's log
    if (st.ino !== inode) {
      inode = st.ino
      offset = 0
      rest = ''
    }
    if (st.size <= offset) return
    const fh = await open(w.file, 'r').catch(() => undefined)
    if (!fh) return
    try {
      const len = Math.min(st.size - offset, CHUNK)
      const buf = Buffer.alloc(len)
      const { bytesRead } = await fh.read(buf, 0, len, offset)
      offset += bytesRead
      const lines = (rest + buf.toString('utf8', 0, bytesRead)).split(/\r?\n/)
      rest = lines.pop() ?? ''
      for (const line of lines) {
        if (needles.some((n) => line.includes(n))) {
          done = true
          matched = true
          clearInterval(timer)
          w.onMatch(line)
          return
        }
      }
    } finally {
      await fh.close().catch(() => undefined)
    }
  }
  // Polls never overlap: a slow read and the exit-time check queue up behind each other.
  const run = (): Promise<void> => (reading = reading.then(poll).catch(() => undefined))
  const timer = setInterval(() => void run(), w.intervalMs ?? 1500)
  return {
    stop() {
      done = true
      clearInterval(timer)
    },
    async check() {
      if (!done) await run()
      return matched
    }
  }
}
