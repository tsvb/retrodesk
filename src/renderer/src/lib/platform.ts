import type { HostOs } from '@shared/types'

/** The OS the UI runs on. Chromium reports "MacIntel" on Intel and Apple Silicon Macs alike. */
export const hostOs: HostOs = typeof navigator !== 'undefined' && /^Mac/i.test(navigator.platform || navigator.userAgent) ? 'macos' : 'windows'
export const isMac = hostOs === 'macos'

/** The path separator the player's OS shows. */
export const sep = isMac ? '/' : '\\'

/** Only Windows power plans can be switched without admin rights. */
export const canSwitchPowerPlan = !isMac

const MAC_KEYS: Record<string, string> = {
  Control: 'Control',
  Ctrl: 'Control',
  Alt: 'Option',
  Option: 'Option',
  Command: 'Command',
  Cmd: 'Command',
  CommandOrControl: 'Command',
  CmdOrCtrl: 'Command',
  Super: 'Command',
  Meta: 'Command'
}
const PC_KEYS: Record<string, string> = { Control: 'Ctrl', CommandOrControl: 'Ctrl', CmdOrCtrl: 'Ctrl', Super: 'Win', Meta: 'Win' }

/** The keys of an Electron accelerator ("Control+Alt+Home") as this OS's keyboard labels them. */
export function acceleratorKeys(accel: string): string[] {
  const names = isMac ? MAC_KEYS : PC_KEYS
  return accel
    .split('+')
    .filter(Boolean)
    .map((k) => names[k] ?? k)
}
