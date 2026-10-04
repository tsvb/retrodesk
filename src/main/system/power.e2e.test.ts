// Opt-in (changes the Windows power mode briefly, then restores it): $env:RETRODESK_E2E='1'; npx vitest run src/main/system/power.e2e.test.ts
import { describe, expect, it } from 'vitest'
import { getStats, setPerformanceMode } from './index'
import { capturePowerState, getActiveOverlay, getActiveScheme, OVERLAYS, restorePowerState } from './power'
import { powerSource } from './stats'

describe.skipIf(process.env['RETRODESK_E2E'] !== '1')('power modes + stats on this machine', () => {
  it('switches overlay modes and restores the original state', async () => {
    const before = await capturePowerState()
    console.log('[power] before', JSON.stringify(before), 'stats', JSON.stringify(await getStats()))
    try {
      for (const mode of ['quiet', 'performance', 'balanced'] as const) {
        await setPerformanceMode(mode)
        const scheme = await getActiveScheme()
        const overlay = await getActiveOverlay(await powerSource())
        console.log(`[power] ${mode}: scheme=${scheme?.name} overlay=${overlay} plan=${(await getStats()).powerPlan}`)
        expect(overlay).toBe(OVERLAYS[mode])
      }
    } finally {
      await restorePowerState(before)
    }
    await new Promise((r) => setTimeout(r, 1200))
    console.log('[power] stats again', JSON.stringify(await getStats()))
    const after = await capturePowerState()
    console.log('[power] after', JSON.stringify(after))
    expect(after).toEqual(before)
  }, 60_000)
})
