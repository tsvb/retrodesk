import { describe, expect, it } from 'vitest'
import { padFamily, resolveButtonLayout } from './pads'

describe('button layout', () => {
  it('"Automatic" confirms with the right button on Nintendo controllers only', () => {
    expect(resolveButtonLayout('auto', padFamily('Nintendo Switch Pro Controller'))).toBe('nintendo')
    expect(resolveButtonLayout('auto', padFamily('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)'))).toBe('nintendo')
    expect(resolveButtonLayout('auto', padFamily('Xbox 360 Controller (XInput STANDARD GAMEPAD)'))).toBe('xbox')
    expect(resolveButtonLayout('auto', padFamily('DualSense Wireless Controller'))).toBe('xbox')
    expect(resolveButtonLayout('auto')).toBe('xbox')
  })

  it('a chosen layout wins over the controller', () => {
    expect(resolveButtonLayout('xbox', 'nintendo')).toBe('xbox')
    expect(resolveButtonLayout('nintendo', 'xbox')).toBe('nintendo')
  })
})
