// Live system stats for the Game Assist overlay: CPU, memory, NVIDIA GPU, battery, power plan.
import { cpus, freemem, totalmem } from 'os'
import type { SystemStats } from '../../shared/types'
import { powershell, run } from './exec'
import { describePowerPlan } from './power'

// ---------------------------------------------------------------------------------------------
// CPU (delta of os.cpus() times between calls)
// ---------------------------------------------------------------------------------------------

export interface CpuSample {
  idle: number
  total: number
}

export function cpuSample(list = cpus()): CpuSample {
  let idle = 0
  let total = 0
  for (const c of list) {
    const t = c.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.irq + t.idle
  }
  return { idle, total }
}

export function cpuPercentBetween(a: CpuSample, b: CpuSample): number {
  const dt = b.total - a.total
  if (dt <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((1 - (b.idle - a.idle) / dt) * 1000) / 10))
}

let lastCpu = cpuSample()
let lastCpuPercent = 0
let lastCpuAt = Date.now()

function cpuPercent(): number {
  // Calls closer than 250ms apart reuse the last value (too little data for a meaningful delta).
  if (Date.now() - lastCpuAt < 250) return lastCpuPercent
  const now = cpuSample()
  lastCpuPercent = cpuPercentBetween(lastCpu, now)
  lastCpu = now
  lastCpuAt = Date.now()
  return lastCpuPercent
}

// ---------------------------------------------------------------------------------------------
// Stale-while-revalidate cache helper
// ---------------------------------------------------------------------------------------------

interface Cached<T> {
  value: T | undefined
  at: number
  pending?: Promise<T | undefined>
  /** Permanently unavailable (e.g. no nvidia-smi). */
  disabled?: boolean
}

type CachedGetter<T> = ((firstWaitMs?: number) => Promise<T | undefined>) & { invalidate(): void }

function makeCached<T>(ttlMs: number, load: (c: Cached<T>) => Promise<T | undefined>): CachedGetter<T> {
  const c: Cached<T> = { value: undefined, at: 0 }
  const refresh = () => {
    c.pending ??= load(c)
      .catch(() => undefined)
      .then((v) => {
        c.value = v
        c.at = Date.now()
        c.pending = undefined
        return v
      })
    return c.pending
  }
  const get = async (firstWaitMs = 2000) => {
    if (c.disabled) return undefined
    if (Date.now() - c.at < ttlMs) return c.value
    const p = refresh()
    if (c.at === 0) {
      // First call (or after invalidate): wait (bounded) for a real value.
      return Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), firstWaitMs))])
    }
    return c.value // stale value now, fresh one next time
  }
  return Object.assign(get, {
    invalidate() {
      c.at = 0
    }
  })
}

// ---------------------------------------------------------------------------------------------
// GPU (nvidia-smi)
// ---------------------------------------------------------------------------------------------

export type GpuStats = NonNullable<SystemStats['gpu']>

/** Parse `nvidia-smi --query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total --format=csv,noheader,nounits`. */
export function parseNvidiaSmi(out: string): GpuStats | undefined {
  const line = out.split(/\r?\n/).find((l) => l.trim())
  if (!line) return undefined
  const parts = line.split(',').map((s) => s.trim())
  if (parts.length < 5) return undefined
  const num = (s: string | undefined) => {
    const n = Number(s)
    return Number.isFinite(n) ? n : 0
  }
  return { name: parts[0]!, utilPercent: num(parts[1]), tempC: num(parts[2]), memUsedMB: num(parts[3]), memTotalMB: num(parts[4]) }
}

const getGpu = makeCached<GpuStats>(1000, async (c) => {
  const r = await run('nvidia-smi', ['--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'], 3000)
  if (r.code !== 0) {
    if (r.errno === 'ENOENT') c.disabled = true
    return undefined
  }
  return parseNvidiaSmi(r.stdout)
})

// ---------------------------------------------------------------------------------------------
// Battery (Win32_Battery)
// ---------------------------------------------------------------------------------------------

export type BatteryStats = NonNullable<SystemStats['battery']>

/** BatteryStatus: 1 discharging, 2 on AC, 3 fully charged, 6-9 charging, 11 partially charged (on AC). */
const ON_AC = new Set([2, 3, 6, 7, 8, 9, 11])

export function parseBatteryJson(out: string): BatteryStats | null {
  const t = out.trim()
  if (!t) return null
  let j: unknown
  try {
    j = JSON.parse(t)
  } catch {
    return null
  }
  const first = (Array.isArray(j) ? j[0] : j) as { EstimatedChargeRemaining?: number; BatteryStatus?: number } | undefined
  if (!first || typeof first.EstimatedChargeRemaining !== 'number') return null
  return { percent: Math.max(0, Math.min(100, first.EstimatedChargeRemaining)), charging: ON_AC.has(Number(first.BatteryStatus)) }
}

/** null = no battery (desktop). */
export const getBattery = makeCached<BatteryStats | null>(30_000, async () => {
  const r = await powershell('Get-CimInstance -ClassName Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress', 10_000)
  if (r.code !== 0) return undefined
  return parseBatteryJson(r.stdout)
})

export async function powerSource(): Promise<'ac' | 'dc'> {
  const b = await getBattery(8000)
  return b && !b.charging ? 'dc' : 'ac'
}

const getPowerPlan = makeCached<string>(5000, () => describePowerPlan())
export const invalidatePowerPlan = (): void => getPowerPlan.invalidate()

export async function collectStats(): Promise<SystemStats> {
  const [gpu, battery, powerPlan] = await Promise.all([getGpu(3000), getBattery(2000), getPowerPlan(2000)])
  const total = totalmem()
  const stats: SystemStats = {
    cpuPercent: cpuPercent(),
    memUsedBytes: total - freemem(),
    memTotalBytes: total
  }
  if (gpu) stats.gpu = gpu
  if (battery) stats.battery = battery
  if (powerPlan) stats.powerPlan = powerPlan
  return stats
}
