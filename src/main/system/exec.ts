import { execFile } from 'child_process'

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
  /** Spawn error code, e.g. 'ENOENT' when the program doesn't exist. */
  errno?: string
}

/** execFile that never rejects (non-zero exit / ENOENT become code != 0). */
export function run(file: string, args: string[], timeoutMs = 10_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const raw = (err as NodeJS.ErrnoException | null)?.code as unknown
      const code = err ? (typeof raw === 'number' ? raw : -1) : 0
      resolve({
        code,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? '') || (err && !stdout ? err.message : ''),
        errno: typeof raw === 'string' ? raw : undefined
      })
    })
  })
}

/** Run a PowerShell snippet (-NoProfile -NonInteractive). */
export function powershell(script: string, timeoutMs = 15_000): Promise<ExecResult> {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], timeoutMs)
}
