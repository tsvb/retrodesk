import { describe, expect, it } from 'vitest'
import { OVERLAYS, parseActiveScheme, parseRegValue } from './power'
import { cpuPercentBetween, parseBatteryJson, parseNvidiaSmi } from './stats'

describe('stats parsing', () => {
  it('parses nvidia-smi csv', () => {
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 5060 Laptop GPU, 37, 52, 1234, 8151\r\n')).toEqual({
      name: 'NVIDIA GeForce RTX 5060 Laptop GPU',
      utilPercent: 37,
      tempC: 52,
      memUsedMB: 1234,
      memTotalMB: 8151
    })
    expect(parseNvidiaSmi('')).toBeUndefined()
    expect(parseNvidiaSmi('garbage')).toBeUndefined()
  })

  it('parses Win32_Battery json', () => {
    expect(parseBatteryJson('{"EstimatedChargeRemaining":99,"BatteryStatus":2}')).toEqual({ percent: 99, charging: true })
    expect(parseBatteryJson('[{"EstimatedChargeRemaining":40,"BatteryStatus":1}]')).toEqual({ percent: 40, charging: false })
    expect(parseBatteryJson('')).toBeNull()
  })

  it('computes cpu percent from samples', () => {
    expect(cpuPercentBetween({ idle: 100, total: 200 }, { idle: 150, total: 400 })).toBe(75)
    expect(cpuPercentBetween({ idle: 100, total: 200 }, { idle: 100, total: 200 })).toBe(0)
  })
})

describe('power parsing', () => {
  it('parses powercfg /getactivescheme (any language)', () => {
    expect(parseActiveScheme('Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)')).toEqual({ guid: '381b4222-f694-41f0-9685-ff5bb260df2e', name: 'Balanced' })
    expect(parseActiveScheme('GUID du mode de gestion de l’alimentation : 8C5E7FDA-E8BF-4A96-9A85-A6E23A8C635C  (Performances élevées)')?.guid).toBe('8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c')
  })
  it('parses reg query output', () => {
    const out = '\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes\r\n    ActiveOverlayAcPowerScheme    REG_SZ    ded574b5-45a0-4f42-8737-46345c09c238\r\n'
    expect(parseRegValue(out, 'ActiveOverlayAcPowerScheme')).toBe(OVERLAYS.performance)
  })
})
