// The host the app runs on. RetroDesk supports Windows and macOS; any other host (Linux, where the unit tests
// also run) is treated like Windows so the Windows code paths stay the ones under test there.
import type { HostOs } from '../shared/types'

export type { HostOs }
export type HostArch = 'x64' | 'arm64'

export function hostOs(platform: NodeJS.Platform = process.platform): HostOs {
  return platform === 'darwin' ? 'macos' : 'windows'
}

export function hostArch(arch: string = process.arch): HostArch {
  return arch === 'arm64' ? 'arm64' : 'x64'
}

export const isMac = (): boolean => hostOs() === 'macos'
