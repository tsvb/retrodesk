import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STANDARD_BUTTONS, startSdlGamepads, toStandard, type GamepadsWorkerMessage, type SdlControllerInstance, type SdlDevice, type SdlModule } from './gamepads-sdl'

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

describe('opening controllers', () => {
  /** A fake SDL whose controllers fail to open while `failing` is set, re-added under a new id the way SDL does. */
  function fakeSdl() {
    let nextId = 0
    const listeners: { add?: (e: { device: SdlDevice }) => void; remove?: (e: { device: SdlDevice }) => void } = {}
    const sdl = {
      failing: true,
      plugged: true,
      opens: 0,
      devices: [] as SdlDevice[],
      connect(path: string) {
        const device = { id: nextId++, name: 'Nintendo Switch Pro Controller', path }
        sdl.devices.push(device)
        listeners.add?.({ device })
        return device
      },
      module: {
        controller: {
          get devices() {
            return sdl.devices
          },
          openDevice(device: SdlDevice): SdlControllerInstance {
            sdl.opens++
            if (sdl.failing) {
              // SDL drops a pad whose open failed and adds it back shortly after.
              sdl.devices = sdl.devices.filter((d) => d !== device)
              listeners.remove?.({ device })
              setTimeout(() => sdl.plugged && sdl.connect(device.path!), 500)
              throw new Error("Couldn't load stick calibration")
            }
            return { device, buttons: {}, axes: {}, closed: false, on() {}, rumble() {}, close() {} }
          },
          on(event: 'deviceAdd' | 'deviceRemove', cb: (e: { device: SdlDevice }) => void) {
            if (event === 'deviceAdd') listeners.add = cb
            else listeners.remove = cb
          }
        }
      } as unknown as SdlModule
    }
    return sdl
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('backs off a controller that keeps failing to open instead of retrying every time SDL re-adds it', () => {
    const sdl = fakeSdl()
    startSdlGamepads(
      () => undefined,
      () => sdl.module
    )
    sdl.connect('pad-1')
    expect(sdl.opens).toBe(1)
    // Re-added after 0.5s: ignored until the 1s backoff is up.
    vi.advanceTimersByTime(999)
    expect(sdl.opens).toBe(1)
    vi.advanceTimersByTime(1)
    expect(sdl.opens).toBe(2)
    // Then 2s, 4s, ... capped at 30s.
    vi.advanceTimersByTime(2000)
    expect(sdl.opens).toBe(3)
    vi.advanceTimersByTime(4000 + 8000 + 16000 + 30_000)
    expect(sdl.opens).toBe(7)
    vi.advanceTimersByTime(30_000)
    expect(sdl.opens).toBe(8)
  })

  it('opens it once it answers, and posts it', () => {
    const sdl = fakeSdl()
    const posts: GamepadsWorkerMessage[] = []
    startSdlGamepads(
      (m) => posts.push(m),
      () => sdl.module
    )
    sdl.connect('pad-1')
    sdl.failing = false
    vi.advanceTimersByTime(1000)
    expect(sdl.opens).toBe(2)
    vi.advanceTimersByTime(100)
    expect(posts.at(-1)).toEqual({ type: 'pads', pads: [expect.objectContaining({ id: 'Nintendo Switch Pro Controller' })] })
  })

  it('tries a reconnected controller straight away once its backoff found it gone', () => {
    const sdl = fakeSdl()
    startSdlGamepads(
      () => undefined,
      () => sdl.module
    )
    sdl.connect('pad-1')
    // Unplugged before SDL adds it back.
    sdl.plugged = false
    vi.advanceTimersByTime(1000)
    sdl.plugged = true
    sdl.failing = false
    sdl.connect('pad-1')
    expect(sdl.opens).toBe(2)
  })
})
