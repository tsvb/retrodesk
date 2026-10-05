import type { HostOs } from '@shared/types'

/** The OS the UI runs on. Chromium reports "MacIntel" on Intel and Apple Silicon Macs alike. */
export const hostOs: HostOs = typeof navigator !== 'undefined' && /^Mac/i.test(navigator.platform || navigator.userAgent) ? 'macos' : 'windows'
export const isMac = hostOs === 'macos'

/** The path separator the player's OS shows. */
export const sep = isMac ? '/' : '\\'

/** Only Windows power plans can be switched without admin rights. */
export const canSwitchPowerPlan = !isMac
