import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

import { STANDARD_BUTTONS, toStandard } from './gamepads'

describe('native controller state', () => {
  it('maps SDL buttons and axes to the W3C standard layout', () => {
    const pad = toStandard(0, 'Nintendo Switch Pro Controller', { a: true, start: true, dpadLeft: true, guide: true }, { leftStickX: -1, rightStickY: 0.5, rightTrigger: 0.8 })
    expect(pad.id).toBe('Nintendo Switch Pro Controller')
    expect(pad.buttons).toHaveLength(17)
    // Standard indices: 0 bottom face button, 7 right trigger, 9 Start, 14 D-pad left, 16 Guide.
    expect(pad.buttons.flatMap((v, i) => (v ? [[i, v]] : []))).toEqual([
      [0, 1],
      [7, 0.8],
      [9, 1],
      [14, 1],
      [16, 1]
    ])
    expect(pad.axes).toEqual([-1, 0, 0, 0.5])
  })

  it('keeps the order RetroDesk binds actions to (LT/RT page, Back+Start combo)', () => {
    expect(STANDARD_BUTTONS.indexOf('leftTrigger')).toBe(6)
    expect(STANDARD_BUTTONS.indexOf('back')).toBe(8)
    expect(STANDARD_BUTTONS.indexOf('start')).toBe(9)
    expect(STANDARD_BUTTONS.indexOf('dpadUp')).toBe(12)
  })
})
