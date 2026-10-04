// RetroArch Network Control Interface client (UDP, default 127.0.0.1:55355).
// One bound socket is used for both sending and receiving, because RetroArch replies to the sender's address.
import dgram from 'dgram'

export type RaState = 'PLAYING' | 'PAUSED' | 'CONTENTLESS'

export interface RaStatus {
  state: RaState
  system?: string
  content?: string
  crc32?: string
}

/** Parse "GET_STATUS PLAYING super_nes,Super Mario World (USA),crc32=b19ed489". Content may contain commas. */
export function parseStatus(reply: string): RaStatus | undefined {
  const m = /^GET_STATUS\s+(PLAYING|PAUSED|CONTENTLESS)(?:\s+(.*))?$/s.exec(reply.trim())
  if (!m) return undefined
  const state = m[1] as RaState
  const rest = m[2]?.trim()
  if (!rest) return { state }
  const crcIdx = rest.lastIndexOf(',crc32=')
  const head = crcIdx >= 0 ? rest.slice(0, crcIdx) : rest
  const crc32 = crcIdx >= 0 ? rest.slice(crcIdx + 7) : undefined
  const comma = head.indexOf(',')
  return {
    state,
    system: comma >= 0 ? head.slice(0, comma) : head,
    content: comma >= 0 ? head.slice(comma + 1) : undefined,
    crc32
  }
}

interface Pending {
  prefix?: string
  resolve: (reply: string | null) => void
  timer: NodeJS.Timeout
}

export class RaCommandClient {
  private sock: dgram.Socket | null = null
  private ready: Promise<dgram.Socket> | null = null
  private pending: Pending[] = []

  constructor(
    readonly port = 55355,
    readonly host = '127.0.0.1'
  ) {}

  private socket(): Promise<dgram.Socket> {
    if (this.ready) return this.ready
    this.ready = new Promise((resolve, reject) => {
      const s = dgram.createSocket('udp4')
      s.on('message', (msg) => this.onMessage(msg.toString('utf8')))
      // ICMP port-unreachable surfaces as an error on Windows (ECONNRESET); it just means "nobody listening".
      s.on('error', (e) => {
        if (!this.sock) reject(e)
        else console.warn('[racommand] socket error', (e as NodeJS.ErrnoException).code ?? e.message)
      })
      s.bind(0, '127.0.0.1', () => {
        s.unref()
        this.sock = s
        resolve(s)
      })
    })
    return this.ready
  }

  private onMessage(text: string): void {
    const reply = text.replace(/\r?\n$/, '')
    let i = this.pending.findIndex((p) => p.prefix && reply.startsWith(p.prefix))
    if (i < 0) i = this.pending.findIndex((p) => !p.prefix)
    if (i < 0) return
    const [p] = this.pending.splice(i, 1)
    clearTimeout(p!.timer)
    p!.resolve(reply)
  }

  /** Fire-and-forget command (no reply expected). */
  async send(cmd: string): Promise<void> {
    const s = await this.socket()
    await new Promise<void>((resolve, reject) => s.send(Buffer.from(cmd, 'utf8'), this.port, this.host, (e) => (e ? reject(e) : resolve())))
  }

  /**
   * Send a command and wait for its reply. Replies are matched by prefix (e.g. "GET_STATUS"), or FIFO when the
   * reply has no prefix (VERSION). Resolves null on timeout.
   */
  async request(cmd: string, opts: { timeoutMs?: number; prefix?: string | null } = {}): Promise<string | null> {
    const prefix = opts.prefix === undefined ? cmd.split(' ')[0] : (opts.prefix ?? undefined)
    const s = await this.socket()
    return new Promise<string | null>((resolve) => {
      const entry: Pending = {
        prefix,
        resolve,
        timer: setTimeout(() => {
          this.pending = this.pending.filter((p) => p !== entry)
          resolve(null)
        }, opts.timeoutMs ?? 500)
      }
      this.pending.push(entry)
      s.send(Buffer.from(cmd, 'utf8'), this.port, this.host, (e) => {
        if (e) {
          clearTimeout(entry.timer)
          this.pending = this.pending.filter((p) => p !== entry)
          resolve(null)
        }
      })
    })
  }

  async getStatus(timeoutMs = 500): Promise<RaStatus | null> {
    const r = await this.request('GET_STATUS', { timeoutMs })
    return r ? (parseStatus(r) ?? null) : null
  }

  async version(timeoutMs = 500): Promise<string | null> {
    return this.request('VERSION', { timeoutMs, prefix: null })
  }

  /** Poll GET_STATUS until RetroArch answers (it opens the port a moment after startup). */
  async waitUntilReady(totalMs = 15_000, intervalMs = 250): Promise<RaStatus | null> {
    const end = Date.now() + totalMs
    while (Date.now() < end) {
      const st = await this.getStatus(intervalMs)
      if (st) return st
    }
    return null
  }

  close(): void {
    for (const p of this.pending) {
      clearTimeout(p.timer)
      p.resolve(null)
    }
    this.pending = []
    try {
      this.sock?.close()
    } catch {
      /* already closed */
    }
    this.sock = null
    this.ready = null
  }
}
