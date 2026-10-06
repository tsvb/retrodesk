// The Game Assist quick actions, declared once. The launcher (what to send RetroArch and how the session changes),
// RetroArch's generated config (the hold-Select hotkeys) and the overlay (buttons, confirmations, toasts, hotkey
// legend) are all derived from this table.
import type { QuickAction, SessionInfo } from './types'

/** Save-state slots offered by the quick menu: 0..MAX_STATE_SLOT. */
export const MAX_STATE_SLOT = 9

/** Controller buttons, by their position on an Xbox pad. */
export type PadButton = 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'LT' | 'RT' | 'BACK' | 'START' | 'L3' | 'R3' | 'DPAD_LEFT' | 'DPAD_RIGHT'

/** How RetroArch names a button for one joypad driver: `input_<x>_btn` or `input_<x>_axis`. */
export interface PadBinding {
  btn?: string
  axis?: string
}

/** RetroArch's joypad driver per OS: XInput on Windows, Apple's GameController framework (mFi) on macOS. */
export type PadDriver = 'xinput' | 'mfi'

/**
 * Button indices per joypad driver.
 * xinput (input/drivers_joypad/xinput_joypad.c): 0=A 1=B 2=X 3=Y 4=LB 5=RB 6=Start 7=Back 8=L3 9=R3; axes +4=LT
 * +5=RT; the D-pad is hat 0.
 * mfi (input/drivers_joypad/mfi_joypad.m): buttons are reported in RetroPad order, so the bottom face button is
 * RetroPad B (0), the right one RetroPad A (8), and the triggers are buttons 12 and 13.
 */
export const PAD_BUTTONS: Record<PadDriver, Record<PadButton, PadBinding>> = {
  xinput: {
    A: { btn: '0' },
    B: { btn: '1' },
    X: { btn: '2' },
    Y: { btn: '3' },
    LB: { btn: '4' },
    RB: { btn: '5' },
    START: { btn: '6' },
    BACK: { btn: '7' },
    L3: { btn: '8' },
    R3: { btn: '9' },
    LT: { axis: '+4' },
    RT: { axis: '+5' },
    DPAD_LEFT: { btn: 'h0left' },
    DPAD_RIGHT: { btn: 'h0right' }
  },
  mfi: {
    A: { btn: '0' },
    X: { btn: '1' },
    BACK: { btn: '2' },
    START: { btn: '3' },
    DPAD_LEFT: { btn: '6' },
    DPAD_RIGHT: { btn: '7' },
    B: { btn: '8' },
    Y: { btn: '9' },
    LB: { btn: '10' },
    RB: { btn: '11' },
    LT: { btn: '12' },
    RT: { btn: '13' },
    L3: { btn: '14' },
    R3: { btn: '15' }
  }
}

/** One button's binding for `driver`, with the unused half of the btn/axis pair cleared. */
export function padBinding(driver: PadDriver, button: PadButton): { btn: string; axis: string } {
  const b = PAD_BUTTONS[driver][button]
  return { btn: b.btn ?? 'nul', axis: b.axis ?? 'nul' }
}

export interface QuickActionHotkey {
  /** RetroArch input name: bound as `input_<input>_btn` / `input_<input>_axis`. */
  input: string
  button: PadButton
  /** What to press together with Select, as shown to the player. */
  pad: string
  /** The same button as a W3C Standard Gamepad index, for controller-specific glyphs. */
  std?: number
}

export interface QuickActionDef {
  label: string
  /** Label while `isActive` (toggles). */
  activeLabel?: string
  /** Works with every emulator. Everything else needs RetroArch's network commands. */
  anyEmulator?: boolean
  /** RetroArch network command sent for this action. */
  command?: string
  /** Folder RetroArch writes a file into when the command worked; the launcher waits for that file. */
  writes?: 'states' | 'screenshots'
  /** False when the action makes no sense right now (first/last slot). */
  available?(s: SessionInfo): boolean
  /** How the session changes once the command has been sent. */
  apply?(s: SessionInfo): void
  isActive?(s: SessionInfo): boolean
  /** In-game shortcut: hold Select and press this. */
  hotkey?: QuickActionHotkey
  /** Ask before running. */
  confirm?(s: SessionInfo): { title: string; description: string; confirmLabel: string }
  /** Shown once the action succeeded. Given the session as it was before the action ran. */
  toast?(s: SessionInfo): string
  /** Close the quick menu afterward. */
  closesMenu?: boolean
}

export const QUICK_ACTIONS: Record<QuickAction, QuickActionDef> = {
  resume: { label: 'Resume', anyEmulator: true },
  save_state: {
    label: 'Save state',
    command: 'SAVE_STATE',
    writes: 'states',
    hotkey: { input: 'save_state', button: 'RB', pad: 'RB', std: 5 },
    toast: (s) => `State saved to slot ${s.stateSlot}`
  },
  load_state: {
    label: 'Load state',
    command: 'LOAD_STATE',
    hotkey: { input: 'load_state', button: 'LB', pad: 'LB', std: 4 },
    toast: (s) => `Loaded state from slot ${s.stateSlot}`
  },
  slot_next: {
    label: 'Next slot',
    command: 'STATE_SLOT_PLUS',
    available: (s) => s.stateSlot < MAX_STATE_SLOT,
    apply: (s) => void (s.stateSlot += 1),
    hotkey: { input: 'state_slot_increase', button: 'DPAD_RIGHT', pad: 'D-pad right' }
  },
  slot_prev: {
    label: 'Previous slot',
    command: 'STATE_SLOT_MINUS',
    // Below slot 0 RetroArch would go to the "auto" slot (-1).
    available: (s) => s.stateSlot > 0,
    apply: (s) => void (s.stateSlot -= 1),
    hotkey: { input: 'state_slot_decrease', button: 'DPAD_LEFT', pad: 'D-pad left' }
  },
  screenshot: {
    label: 'Screenshot',
    command: 'SCREENSHOT',
    writes: 'screenshots',
    hotkey: { input: 'screenshot', button: 'Y', pad: 'Y', std: 3 },
    toast: () => 'Screenshot saved'
  },
  fast_forward: {
    label: 'Fast forward',
    activeLabel: 'Normal speed',
    command: 'FAST_FORWARD',
    apply: (s) => void (s.fastForward = !s.fastForward),
    isActive: (s) => !!s.fastForward,
    hotkey: { input: 'toggle_fast_forward', button: 'RT', pad: 'RT', std: 7 },
    toast: (s) => (s.fastForward ? 'Normal speed' : 'Fast-forward on')
  },
  pause_toggle: {
    label: 'Pause',
    activeLabel: 'Unpause',
    command: 'PAUSE_TOGGLE',
    apply: (s) => void (s.paused = !s.paused),
    isActive: (s) => !!s.paused
  },
  reset: {
    label: 'Reset',
    command: 'RESET',
    confirm: () => ({
      title: 'Reset the game?',
      description: "It restarts from the beginning, like pressing the console's reset button.",
      confirmLabel: 'Reset'
    }),
    toast: () => 'Game reset',
    closesMenu: true
  },
  retroarch_menu: {
    label: 'RetroArch menu',
    command: 'MENU_TOGGLE',
    hotkey: { input: 'menu_toggle', button: 'X', pad: 'X', std: 2 },
    closesMenu: true
  },
  quit: {
    label: 'Quit game',
    anyEmulator: true,
    confirm: (s) => ({
      title: `Quit ${s.title}?`,
      description: s.supportsCommands ? 'If quick resume is on, your progress is saved before closing.' : 'Unsaved progress since your last in-game save will be lost.',
      confirmLabel: 'Quit game'
    }),
    closesMenu: true
  }
}

/** RetroArch config entries for every hold-Select hotkey on `driver`: the unused half of each btn/axis pair is cleared. */
export function hotkeyBindings(driver: PadDriver = 'xinput'): Record<string, string> {
  const cfg: Record<string, string> = {}
  for (const def of Object.values(QUICK_ACTIONS)) {
    if (!def.hotkey) continue
    const b = padBinding(driver, def.hotkey.button)
    cfg[`input_${def.hotkey.input}_btn`] = b.btn
    cfg[`input_${def.hotkey.input}_axis`] = b.axis
  }
  return cfg
}
