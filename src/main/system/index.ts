import type { PerformanceMode, SystemStats } from '../../shared/types'
import { applyPerformanceMode, capturePowerState, restorePowerState as restorePower, setPowerSourceProvider, type PowerState } from './power'
import { collectStats, invalidatePowerPlan, powerSource } from './stats'

export { capturePowerState, type PowerState }

setPowerSourceProvider(powerSource)

export async function getStats(): Promise<SystemStats> {
  return collectStats()
}

export async function setPerformanceMode(mode: PerformanceMode): Promise<void> {
  try {
    await applyPerformanceMode(mode)
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
