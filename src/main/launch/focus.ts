// Bring an emulator window back to the foreground after the overlay closes.
// A single long-lived PowerShell helper (user32 via Add-Type) is spawned per game session so each request is fast
// (~ms) instead of paying PowerShell start-up every time. The C# is compiled once into a DLL next to the app data
// (named after a hash of the source, so an update recompiles) and only loaded afterwards: compiling runs csc and
// costs a second or two of CPU, which would otherwise compete with every emulator boot.
import { createHash } from 'crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'

const CSHARP = String.raw`
using System;
using System.Runtime.InteropServices;
public static class RDFocus {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool alt);
  public static IntPtr Find(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h) && GetWindow(h, 4) == IntPtr.Zero) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static string Focus(uint pid) {
    IntPtr h = Find(pid);
    if (h == IntPtr.Zero) return "NOWINDOW";
    if (IsIconic(h)) ShowWindow(h, 9);
    if (GetForegroundWindow() == h) return "OK";
    // A background process may not take the foreground; attaching to the foreground thread's input lifts the lock.
    IntPtr fg = GetForegroundWindow();
    uint fgT = GetWindowThreadProcessId(fg, IntPtr.Zero);
    uint me = GetCurrentThreadId();
    uint target = GetWindowThreadProcessId(h, IntPtr.Zero);
    bool a1 = fgT != 0 && AttachThreadInput(me, fgT, true);
    bool a2 = fgT != 0 && target != fgT && AttachThreadInput(target, fgT, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (a2) AttachThreadInput(target, fgT, false);
    if (a1) AttachThreadInput(me, fgT, false);
    if (GetForegroundWindow() == h) return "OK";
    SwitchToThisWindow(h, true);
    System.Threading.Thread.Sleep(50);
    return GetForegroundWindow() == h ? "OK" : "FAIL";
  }
}
`

const DLL_PREFIX = 'rdfocus-'
const DLL_NAME = `${DLL_PREFIX}${createHash('sha1').update(CSHARP).digest('hex').slice(0, 12)}.dll`

const psQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`

/**
 * The helper script. With `dll`, the C# is compiled into that file if it isn't there yet (via a temporary name,
 * so a half-written DLL is never picked up) and loaded from it; anything going wrong falls back to compiling
 * in memory. Requests are "<id> <pid>", replies "<id> <result>".
 */
function script(dll: string | undefined): string {
  return String.raw`
$ErrorActionPreference = 'Stop'
$src = @'
${CSHARP}
'@
$dll = ${dll ? psQuote(dll) : "''"}
if ($dll -and -not (Test-Path -LiteralPath $dll)) {
  $tmp = $dll -replace '\.dll$', ".$PID.tmp.dll"
  try {
    Add-Type -TypeDefinition $src -OutputAssembly $tmp -OutputType Library
    Move-Item -LiteralPath $tmp -Destination $dll -Force
  } catch {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
}
$loaded = $false
if ($dll -and (Test-Path -LiteralPath $dll)) {
  try { Add-Type -Path $dll; $loaded = $true } catch { Remove-Item -LiteralPath $dll -Force -ErrorAction SilentlyContinue }
}
if (-not $loaded) { Add-Type -TypeDefinition $src }
[Console]::Out.WriteLine('READY')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null -or $line -eq 'EXIT') { break }
  $id, $target = $line.Split(' ', 2)
  try { $r = [RDFocus]::Focus([uint32]$target) } catch { $r = 'ERR ' + $_.Exception.Message }
  [Console]::Out.WriteLine($id + ' ' + ($r -replace '\s+', ' '))
}
`
}

/** DLLs compiled from an older version of the source (and leftovers of an interrupted compile). */
function removeStaleDlls(dir: string): void {
  for (const f of readdirSync(dir)) {
    if (f.startsWith(DLL_PREFIX) && f.endsWith('.dll') && f !== DLL_NAME) rmSync(join(dir, f), { force: true })
  }
}

interface Connection {
  child: ChildProcessWithoutNullStreams
  ready: Promise<boolean>
  /** Requests waiting for their reply, by id. */
  pending: Map<number, (reply: string) => void>
}

export interface FocusHelperOptions {
  /** Where the compiled helper DLL is kept. Without it the C# is compiled in memory on every start. */
  cacheDir?: () => string
}

export class FocusHelper {
  private conn: Connection | null = null
  private nextId = 1
  private warmTimer: NodeJS.Timeout | undefined

  constructor(private readonly opts: FocusHelperOptions = {}) {}

  private dllPath(): string | undefined {
    try {
      const dir = this.opts.cacheDir?.()
      if (!dir) return undefined
      const dll = join(dir, DLL_NAME)
      if (!existsSync(dll)) removeStaleDlls(dir)
      return dll
    } catch {
      return undefined
    }
  }

  /** Start the helper in `delayMs`, away from the emulator's start-up. focus() still starts it at once if needed sooner. */
  prewarm(delayMs: number): void {
    clearTimeout(this.warmTimer)
    this.warmTimer = setTimeout(() => void this.start(), delayMs)
    this.warmTimer.unref()
  }

  /** Start the helper (idempotent). Resolves false if PowerShell is unavailable. */
  start(): Promise<boolean> {
    clearTimeout(this.warmTimer)
    if (this.conn) return this.conn.ready
    let settle!: (ok: boolean) => void
    let settled = false
    const ready = new Promise<boolean>((resolve) => {
      settle = (ok) => {
        if (settled) return
        settled = true
        resolve(ok)
      }
    })
    let child: ChildProcessWithoutNullStreams
    try {
      const encoded = Buffer.from(script(this.dllPath()), 'utf16le').toString('base64')
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: 'pipe' })
    } catch {
      return Promise.resolve(false)
    }
    const conn: Connection = { child, ready, pending: new Map() }
    this.conn = conn
    let buf = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => {
      buf += d
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line === 'READY') {
          settle(true)
          continue
        }
        // A reply to a request that already timed out has no waiter any more and is dropped.
        const m = /^(\d+) (.*)$/.exec(line)
        const waiter = m ? conn.pending.get(Number(m[1])) : undefined
        if (!waiter) continue
        conn.pending.delete(Number(m![1]))
        waiter(m![2]!)
      }
    })
    child.stderr.on('data', () => undefined)
    child.stdin.on('error', () => undefined)
    child.on('error', () => settle(false))
    child.on('exit', () => {
      settle(false)
      for (const w of conn.pending.values()) w('EXITED')
      conn.pending.clear()
      // stop() + start() may already have replaced this helper with the next session's: leave that one alone.
      if (this.conn === conn) this.conn = null
    })
    setTimeout(() => {
      if (settled) return
      settle(false)
      child.kill()
    }, 15_000).unref()
    return ready
  }

  /** Focus the top-level window of `pid`. Resolves "OK" | "FAIL" | "NOWINDOW" | "ERR ..." | "UNAVAILABLE". */
  async focus(pid: number, timeoutMs = 3000): Promise<string> {
    if (!(await this.start())) return 'UNAVAILABLE'
    const conn = this.conn
    if (!conn) return 'UNAVAILABLE'
    const id = this.nextId++
    return new Promise<string>((resolve) => {
      const t = setTimeout(() => {
        conn.pending.delete(id)
        resolve('TIMEOUT')
      }, timeoutMs)
      conn.pending.set(id, (reply) => {
        clearTimeout(t)
        resolve(reply)
      })
      conn.child.stdin.write(`${id} ${pid}\n`)
    })
  }

  stop(): void {
    clearTimeout(this.warmTimer)
    const conn = this.conn
    if (!conn) return
    const c = conn.child
    try {
      c.stdin.write('EXIT\n')
      c.stdin.end()
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      if (c.exitCode === null) c.kill()
    }, 1500).unref()
    this.conn = null
  }
}
