// Ambient declarations for the renderer bundle (Vite handles these imports).
declare module '*.css'

/** Battery Status API (Chromium only, not in the TS DOM lib). */
interface BatteryManager extends EventTarget {
  readonly charging: boolean
  readonly level: number
}

interface Navigator {
  getBattery?: () => Promise<BatteryManager>
}
