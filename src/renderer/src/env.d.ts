// Ambient declarations for the renderer bundle (Vite handles these imports).
declare module '*.css'

/** The one Vite build flag the renderer reads (true on the dev server, false in a production build). */
interface ImportMeta {
  readonly env: { readonly DEV: boolean }
}

/** Battery Status API (Chromium only, not in the TS DOM lib). */
interface BatteryManager extends EventTarget {
  readonly charging: boolean
  readonly level: number
}

interface Navigator {
  getBattery?: () => Promise<BatteryManager>
}
