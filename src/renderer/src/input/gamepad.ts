import { emitAction, emitNav } from './bus'
import { padFamily, useInputStore, type PadInfo } from '../stores/input'
import type { Action, Direction } from './types'

/**
 * Gamepad polling (standard mapping). D-pad and left stick navigate with an initial delay then repeat;
 * face/shoulder buttons fire on press. In the main window input is ignored while the window is not
 * focused (XInput is global and a game is running on top). The overlay window instead watches for the
 * quick-menu combo while inactive.
 *
 * Chromium's background throttling is off for both windows (so the overlay can watch the pad over a fullscreen
 * game), which means nothing slows this loop down for us. The main window polls every frame only while it has
 * focus and drops to a slow timer otherwise; the overlay polls on a ~60 Hz timer (a 400 ms hold needs no vsync,
 * and rAF stops when the compositor stops drawing the parked overlay window).
 */

const REPEAT_DELAY = 350
const REPEAT_RATE = 80
const STICK_ON = 0.55
const STICK_OFF = 0.35
const COMBO_HOLD_MS = 400
/** Overlay poll interval. */
const OVERLAY_POLL_MS = 16
/** Main-window poll interval while unfocused: enough to notice pads connecting and focus coming back. */
const IDLE_POLL_MS = 250
export const GUIDE_BUTTON = 16

type Logical = Direction | 'b0' | 'b1' | 'b2' | 'b3' | 'b4' | 'b5' | 'b6' | 'b7' | 'b8' | 'b9' | 'b16'

interface KeyState {
  down: boolean
  since: number
  lastFire: number
  /** Held from before input was accepted; must be released before it can fire. */
  consumed: boolean
}

export interface GamepadOptions {
  /** 'main' ignores input when the document is unfocused. 'overlay' asks `isActive()` instead. */
  mode: 'main' | 'overlay'
  getLayout: () => 'xbox' | 'nintendo'
  getCombo?: () => number[]
  isActive?: () => boolean
  onCombo?: () => void
}

const REPEATING = new Set<Logical>(['up', 'down', 'left', 'right', 'b6', 'b7'])
const BUTTONS: { key: Logical; index: number }[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ key: `b${i}` as Logical, index: i }))

export function installGamepad(opts: GamepadOptions): () => void {
  const states = new Map<Logical, KeyState>()
  let raf = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  /** Set when the main window regains focus: buttons already held then must not fire. */
  let refocused = false
  /** Connected pads this tick (reused to avoid per-frame garbage). */
  const pads: Gamepad[] = []
  let comboSince = 0
  let comboFired = false
  let guideWasDown = false
  let lastPadsCheck = 0

  const refreshPads = () => {
    const pads: PadInfo[] = []
    for (const gp of navigator.getGamepads()) if (gp && gp.connected) pads.push({ index: gp.index, id: gp.id, family: padFamily(gp.id) })
    useInputStore.getState().setPads(pads)
    return pads
  }
  const onConnect = () => {
    refreshPads()
    useInputStore.getState().setSource('pad')
  }
  window.addEventListener('gamepadconnected', onConnect)
  window.addEventListener('gamepaddisconnected', refreshPads)

  const fire = (key: Logical) => {
    if (key === 'up' || key === 'down' || key === 'left' || key === 'right') {
      emitNav(key, 'pad')
      return
    }
    const layout = opts.getLayout()
    const confirmBtn = layout === 'nintendo' ? 'b1' : 'b0'
    const backBtn = layout === 'nintendo' ? 'b0' : 'b1'
    const map: Partial<Record<Logical, Action>> = {
      [confirmBtn]: 'confirm',
      [backBtn]: 'back',
      b2: 'favorite',
      b3: 'search',
      b4: 'tabPrev',
      b5: 'tabNext',
      b6: 'pageUp',
      b7: 'pageDown',
      b8: 'view',
      b9: 'menu'
    }
    const action = map[key]
    if (action) emitAction(action, 'pad')
  }

  const schedule = () => {
    if (stopped) return
    if (opts.mode === 'overlay') timer = setTimeout(() => tick(performance.now()), OVERLAY_POLL_MS)
    else if (document.hasFocus()) raf = requestAnimationFrame(tick)
    else timer = setTimeout(() => tick(performance.now()), IDLE_POLL_MS)
  }
  const onFocus = () => {
    if (opts.mode !== 'main' || stopped) return
    // Back from the slow idle poll straight away.
    clearTimeout(timer)
    cancelAnimationFrame(raf)
    refocused = true
    raf = requestAnimationFrame(tick)
  }
  window.addEventListener('focus', onFocus)

  const pressed = (i: number): boolean => {
    for (const p of pads) {
      const b = p.buttons[i]
      if (b && (b.pressed || b.value > 0.5)) return true
    }
    return false
  }
  const axis = (i: number): number => {
    let v = 0
    for (const p of pads) {
      const a = p.axes[i] ?? 0
      if (Math.abs(a) > Math.abs(v)) v = a
    }
    return v
  }

  const tick = (now: number) => {
    schedule()
    if (now - lastPadsCheck > 1000) {
      lastPadsCheck = now
      refreshPads()
    }
    pads.length = 0
    for (const g of navigator.getGamepads()) if (g && g.connected) pads.push(g)
    if (!pads.length) {
      states.clear()
      return
    }

    // --- quick-menu combo / Guide (overlay always; harmless elsewhere) ---
    if (opts.onCombo) {
      const combo = opts.getCombo?.() ?? [8, 9]
      let comboDown = combo.length > 0
      for (const i of combo) if (!pressed(i)) comboDown = false
      if (comboDown) {
        if (!comboSince) comboSince = now
        if (!comboFired && now - comboSince >= COMBO_HOLD_MS) {
          comboFired = true
          consumeAll()
          opts.onCombo()
        }
      } else {
        comboSince = 0
        comboFired = false
      }
      const guide = pressed(GUIDE_BUTTON)
      if (guide && !guideWasDown) {
        consumeAll()
        opts.onCombo()
      }
      guideWasDown = guide
    }

    let accepting = opts.mode === 'main' ? document.hasFocus() : (opts.isActive?.() ?? false)
    if (refocused) {
      // The idle poll may have missed a press made just before focus returned (e.g. the button that quit the game).
      refocused = false
      accepting = false
    }

    const stickX = axis(0)
    const stickY = axis(1)
    const dirHeld = (d: Direction, btn: number, stick: number, sign: 1 | -1): boolean => {
      const prev = states.get(d)?.down ?? false
      const s = stick * sign
      return pressed(btn) || (prev ? s > STICK_OFF : s > STICK_ON)
    }
    // While the combo is being held, Back/Start must not act on their own.
    const comboHeld = comboSince > 0

    const update = (key: Logical, down: boolean) => {
      let st = states.get(key)
      if (!st) {
        st = { down: false, since: 0, lastFire: 0, consumed: false }
        states.set(key, st)
      }
      if (!down) {
        if (st.down && !st.consumed && accepting && (key === 'b8' || key === 'b9') && !comboHeld) {
          // Back/Start fire on release so they can take part in the combo without side effects.
          if (now - st.since < 600) fire(key)
        }
        st.down = false
        st.consumed = false
        return
      }
      if (!st.down) {
        st.down = true
        st.since = now
        st.lastFire = now
        st.consumed = !accepting
        if (!st.consumed && key !== 'b8' && key !== 'b9') fire(key)
        return
      }
      if (!accepting) {
        st.consumed = true
        return
      }
      if (st.consumed || !REPEATING.has(key)) return
      if (now - st.since >= REPEAT_DELAY && now - st.lastFire >= REPEAT_RATE) {
        st.lastFire = now
        fire(key)
      }
    }
    update('up', dirHeld('up', 12, stickY, -1))
    update('down', dirHeld('down', 13, stickY, 1))
    update('left', dirHeld('left', 14, stickX, -1))
    update('right', dirHeld('right', 15, stickX, 1))
    for (const b of BUTTONS) update(b.key, pressed(b.index))
    if (comboHeld) {
      const b8 = states.get('b8')
      const b9 = states.get('b9')
      if (b8?.down) b8.consumed = true
      if (b9?.down) b9.consumed = true
    }
  }

  const consumeAll = () => {
    for (const st of states.values()) if (st.down) st.consumed = true
  }

  refreshPads()
  schedule()
  return () => {
    stopped = true
    cancelAnimationFrame(raf)
    clearTimeout(timer)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('gamepadconnected', onConnect)
    window.removeEventListener('gamepaddisconnected', refreshPads)
  }
}
