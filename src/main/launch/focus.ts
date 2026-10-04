// Bring an emulator window back to the foreground after the overlay closes.
// A single long-lived PowerShell helper (user32 via Add-Type) is spawned per game session so each request is fast
// (~ms) instead of paying PowerShell + C# compile start-up (~1s) every time.
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
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
"@
[Console]::Out.WriteLine('READY')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null -or $line -eq 'EXIT') { break }
  try { [Console]::Out.WriteLine([RDFocus]::Focus([uint32]$line)) } catch { [Console]::Out.WriteLine('ERR ' + $_.Exception.Message) }
}
`

export class FocusHelper {
  private child: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<boolean> | null = null
  private waiters: ((line: string) => void)[] = []
  private buf = ''

  /** Start the helper (idempotent). Resolves false if PowerShell is unavailable. */
  start(): Promise<boolean> {
    if (this.ready) return this.ready
    this.ready = new Promise<boolean>((resolve) => {
      let settled = false
      const done = (v: boolean) => {
        if (!settled) {
          settled = true
          resolve(v)
        }
      }
      try {
        const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: 'pipe' })
        this.child = child
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (d: string) => {
          this.buf += d
          let i: number
          while ((i = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, i).trim()
            this.buf = this.buf.slice(i + 1)
            if (!line) continue
            if (line === 'READY') done(true)
            else this.waiters.shift()?.(line)
          }
        })
        child.stderr.on('data', () => undefined)
        child.on('error', () => done(false))
        child.on('exit', () => {
          done(false)
          for (const w of this.waiters.splice(0)) w('EXITED')
          this.child = null
          this.ready = null
        })
        setTimeout(() => done(false), 15_000).unref()
      } catch {
        done(false)
      }
    })
    return this.ready
  }

  /** Focus the top-level window of `pid`. Resolves "OK" | "FAIL" | "NOWINDOW" | "ERR ..." | "UNAVAILABLE". */
  async focus(pid: number, timeoutMs = 3000): Promise<string> {
    if (!(await this.start()) || !this.child) return 'UNAVAILABLE'
    const child = this.child
    return new Promise<string>((resolve) => {
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter)
        resolve('TIMEOUT')
      }, timeoutMs)
      const waiter = (line: string) => {
        clearTimeout(t)
        resolve(line)
      }
      this.waiters.push(waiter)
      child.stdin.write(`${pid}\n`)
    })
  }

  stop(): void {
    const c = this.child
    if (!c) return
    try {
      c.stdin.write('EXIT\n')
      c.stdin.end()
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      if (c.exitCode === null) c.kill()
    }, 1500).unref()
    this.child = null
    this.ready = null
  }
}
