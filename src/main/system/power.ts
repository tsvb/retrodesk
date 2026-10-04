// Windows power mode control: Windows 10/11 power-mode overlays first (no admin needed, only effective on the
// Balanced scheme), classic power schemes as a fallback.
import type { PerformanceMode } from '../../shared/types'
import { run } from './exec'

type ActiveMode = Exclude<PerformanceMode, 'unchanged'>

export const OVERLAYS: Record<ActiveMode, string> = {
  quiet: '961cc777-2547-4f9d-8174-7d86181b8a7a', // Best power efficiency
  balanced: '00000000-0000-0000-0000-000000000000',
  performance: 'ded574b5-45a0-4f42-8737-46345c09c238' // Best performance
}

export const SCHEMES: Record<ActiveMode, string> = {
  quiet: 'a1841308-3541-4fab-bc81-f71556f20b4a', // Power saver
  balanced: '381b4222-f694-41f0-9685-ff5bb260df2e',
  performance: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' // High performance
}
const ULTIMATE = 'e9a42b02-d5df-448d-aa00-03f14749eb61'

const OVERLAY_NAMES: Record<string, string> = {
  [OVERLAYS.quiet]: 'Best power efficiency',
  [OVERLAYS.balanced]: 'Balanced',
  [OVERLAYS.performance]: 'Best performance',
  // Older Windows 10 "better battery" / "better performance" overlays.
  '3af9b8d9-7c97-431d-ad78-34a8bfea439f': 'Better performance'
}

const REG_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes'

export interface PowerState {
  scheme?: string
  overlay?: string
  source: 'ac' | 'dc'
}

/** Parse `powercfg /getactivescheme` -> { guid, name }. */
export function parseActiveScheme(out: string): { guid: string; name: string } | undefined {
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*\(([^)]*)\)/i.exec(out)
  return m ? { guid: m[1]!.toLowerCase(), name: m[2]!.trim() } : undefined
}

/** Parse a `reg query ... /v <name>` REG_SZ value. */
export function parseRegValue(out: string, name: string): string | undefined {
  const m = new RegExp(`${name}\\s+REG_\\w+\\s+(\\S+)`, 'i').exec(out)
  return m?.[1]?.toLowerCase()
}

export async function getActiveScheme(): Promise<{ guid: string; name: string } | undefined> {
  const r = await run('powercfg', ['/getactivescheme'], 5000)
  return r.code === 0 ? parseActiveScheme(r.stdout) : undefined
}

export async function getActiveOverlay(source: 'ac' | 'dc'): Promise<string | undefined> {
  const name = source === 'ac' ? 'ActiveOverlayAcPowerScheme' : 'ActiveOverlayDcPowerScheme'
  const r = await run('reg', ['query', REG_KEY, '/v', name], 5000)
  return r.code === 0 ? parseRegValue(r.stdout, name) : undefined
}

let sourceProvider: () => Promise<'ac' | 'dc'> = async () => 'ac'
/** system/index.ts registers the real provider (avoids an import cycle). */
export function setPowerSourceProvider(fn: () => Promise<'ac' | 'dc'>): void {
  sourceProvider = fn
}

export async function capturePowerState(): Promise<PowerState> {
  const source = await sourceProvider()
  const [scheme, overlay] = await Promise.all([getActiveScheme(), getActiveOverlay(source)])
  return { scheme: scheme?.guid, overlay, source }
}

async function powercfg(...args: string[]): Promise<boolean> {
  const r = await run('powercfg', args, 8000)
  return r.code === 0
}

/** `current`: a state captured just before (the launcher's), which saves looking up the active scheme again. */
export async function applyPerformanceMode(mode: PerformanceMode, current?: PowerState): Promise<void> {
  if (mode === 'unchanged') return
  const scheme = current ? current.scheme : (await getActiveScheme())?.guid
  const onBalanced = !scheme || scheme === SCHEMES.balanced
  if (onBalanced && (await powercfg('/overlaysetactive', OVERLAYS[mode]))) return
  // Classic schemes (desktops / machines with custom plans).
  if (await powercfg('/setactive', SCHEMES[mode])) return
  if (mode === 'performance' && (await powercfg('/setactive', ULTIMATE))) return
  // Modern-standby laptops only have Balanced: switch to it and use the overlay instead.
  if (!onBalanced && (await powercfg('/setactive', SCHEMES.balanced)) && (await powercfg('/overlaysetactive', OVERLAYS[mode]))) return
  throw new Error(`Could not switch Windows power mode to "${mode}"`)
}

export async function restorePowerState(s: PowerState): Promise<void> {
  const [now, overlay] = await Promise.all([getActiveScheme(), s.overlay ? getActiveOverlay(s.source) : undefined])
  const switched = !!s.scheme && now?.guid !== s.scheme
  if (switched) await powercfg('/setactive', s.scheme!)
  // Switching schemes can reset the overlay, so the overlay read above only counts if the scheme stayed put.
  if (s.overlay && (switched || overlay !== s.overlay)) await powercfg('/overlaysetactive', s.overlay)
}

/** Human readable plan name for SystemStats.powerPlan. */
export async function describePowerPlan(): Promise<string | undefined> {
  const scheme = await getActiveScheme()
  if (!scheme) return undefined
  if (scheme.guid === SCHEMES.balanced) {
    const overlay = await getActiveOverlay(await sourceProvider())
    const name = overlay ? OVERLAY_NAMES[overlay] : undefined
    if (name) return name
  }
  return scheme.name
}
