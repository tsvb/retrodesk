import { powerMonitor } from 'electron'
import type { PerformanceMode, SystemStats } from '../../shared/types'
import { hostOs } from '../platform'
import { applyPerformanceMode, capturePowerState, restorePowerState as restorePower, setPowerSourceProvider, type PowerState } from './power'
import { collectStats, invalidatePowerPlan, powerSource } from './stats'

export { capturePowerState, type PowerState }

// Electron knows the power source instantly; asking Win32_Battery through PowerShell takes up to a couple of
// seconds on a cold start, which would sit right in the game launch path. The battery query is the fallback
// outside Electron (the opt-in power e2e test runs under plain Node).
setPowerSourceProvider(async () => {
  if (typeof powerMonitor?.isOnBatteryPower === 'function') return powerMonitor.isOnBatteryPower() ? 'dc' : 'ac'
  return powerSource()
})

export async function getStats(): Promise<SystemStats> {
  return collectStats()
}

/** Whether this OS lets RetroDesk switch power plans (Windows only). */
export const canSwitchPowerPlan = (): boolean => hostOs() === 'windows'

export async function setPerformanceMode(mode: PerformanceMode): Promise<void> {
  if (!canSwitchPowerPlan()) return
  try {
    await applyPerformanceMode(mode)
  } finally {
    invalidatePowerPlan()
  }
}

/** Switch to `mode` right after capturing `current` (the launcher), without looking the active plan up again. */
export async function enterPerformanceMode(mode: PerformanceMode, current: PowerState): Promise<void> {
  try {
    await applyPerformanceMode(mode, current)
  } finally {
    invalidatePowerPlan()
  }
}

/** Restore a state captured with capturePowerState() (used by the launcher when a game exits). */
export async function restorePowerState(state: PowerState): Promise<void> {
  try {
    await restorePower(state)
  } finally {
    invalidatePowerPlan()
  }
}
