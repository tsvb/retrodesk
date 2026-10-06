// Controller families and the face-button layout, shared by the UI (menus, hints) and the main process (RetroArch's
// menu), so "Automatic" resolves the same way in both.
import type { ButtonLayout } from './types'

export type PadFamily = 'xbox' | 'playstation' | 'nintendo' | 'generic'

/** The family of a controller, from its Gamepad API id or SDL name. */
export function padFamily(id: string): PadFamily {
  const s = id.toLowerCase()
  if (s.includes('054c') || s.includes('dualsense') || s.includes('dualshock') || s.includes('wireless controller') || s.includes('playstation')) return 'playstation'
  if (s.includes('057e') || s.includes('pro controller') || s.includes('joy-con') || s.includes('nintendo')) return 'nintendo'
  if (s.includes('xinput') || s.includes('xbox') || s.includes('045e') || s.includes('standard gamepad')) return 'xbox'
  return 'generic'
}

/** Which button confirms: 'auto' follows the controller (Nintendo pads confirm with the right button, A). */
export function resolveButtonLayout(setting: ButtonLayout, family?: PadFamily): 'xbox' | 'nintendo' {
  if (setting !== 'auto') return setting
  return family === 'nintendo' ? 'nintendo' : 'xbox'
}
