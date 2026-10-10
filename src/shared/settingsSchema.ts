// Settings that are a choice or an on/off switch, declared once. From each entry come: the value's type
// (Settings in types.ts), its default (main/settings.ts), validation of what the renderer or a hand-edited
// settings.json may store, the control in the Settings screens, and the RetroArch config it maps to.
import type { HostOs, Settings } from './types'

export interface Choice<T extends string = string> {
  value: T
  label: string
  hint?: string
  /** RetroArch config written while this option is selected. */
  cfg?: Record<string, string>
  /** Shader presets for this option, best first (paths relative to the RetroArch dir). */
  presets?: string[]
  /** Only offered on this OS (e.g. Direct3D on Windows, Metal on macOS). */
  os?: HostOs
}

export interface ChoiceSetting<T extends string = string> {
  kind: 'choice'
  title: string
  description?: string
  /** A few short options sit side by side; longer lists open a picker. */
  control: 'segmented' | 'picker'
  default: T
  options: readonly Choice<T>[]
}

export interface ToggleSetting {
  kind: 'toggle'
  title: string
  description?: string
  default: boolean
  /** RetroArch config keys that mirror this switch ("true"/"false"). */
  cfg?: string[]
}

const choice = <const T extends string>(d: Omit<ChoiceSetting<T>, 'kind' | 'default'> & { default: NoInfer<T> }): ChoiceSetting<T> => ({ kind: 'choice', ...d })
const toggle = (d: Omit<ToggleSetting, 'kind'>): ToggleSetting => ({ kind: 'toggle', ...d })

const SLANG = 'shaders/shaders_slang'

export const SETTINGS_SCHEMA = {
  'ui.theme': choice({
    title: 'Theme',
    control: 'segmented',
    default: 'midnight',
    options: [
      { value: 'midnight', label: 'Midnight' },
      { value: 'amoled', label: 'AMOLED black' },
      { value: 'light', label: 'Daylight' },
      { value: 'retro', label: 'Dot matrix' }
    ]
  }),
  'ui.density': choice({
    title: 'Game grid density',
    description: 'Comfortable is sized for a TV across the room; compact fits more covers on a desk monitor.',
    control: 'segmented',
    default: 'comfortable',
    options: [
      { value: 'comfortable', label: 'Comfortable' },
      { value: 'compact', label: 'Compact' }
    ]
  }),
  'ui.hideEmptySystems': toggle({ title: 'Hide systems without games', default: true }),
  'ui.startFullscreen': toggle({ title: 'Start in full screen', description: 'Recommended on a TV. F11 switches at any time.', default: false }),
  'ui.sounds': toggle({ title: 'Interface sounds', description: 'Soft clicks when moving and selecting.', default: true }),
  'ui.haptics': toggle({ title: 'Controller rumble', description: 'A short pulse when you select, go back or start a game.', default: true }),
  'ui.buttonLayout': choice({
    title: 'Button layout',
    control: 'segmented',
    default: 'auto',
    options: [
      { value: 'auto', label: 'Automatic', hint: 'Matches the controller' },
      { value: 'xbox', label: 'Xbox', hint: 'Bottom button confirms (Xbox, PlayStation)' },
      { value: 'nintendo', label: 'Nintendo', hint: 'Right button confirms (Switch, Retroid)' }
    ]
  }),

  'retroarch.shader': choice({
    title: 'Shader',
    description: 'CRT adds scanlines and glow, LCD imitates handheld pixel grids, Sharp keeps pixels crisp when scaling.',
    control: 'segmented',
    default: 'none',
    options: [
      { value: 'none', label: 'None' },
      { value: 'crt', label: 'CRT', presets: [`${SLANG}/crt/crt-geom.slangp`, `${SLANG}/crt/crt-easymode.slangp`, `${SLANG}/crt/crt-royale.slangp`, `${SLANG}/crt/crt-lottes.slangp`] },
      { value: 'lcd', label: 'LCD', presets: [`${SLANG}/handheld/lcd-grid-v2.slangp`, `${SLANG}/handheld/lcd3x.slangp`, `${SLANG}/handheld/lcd1x.slangp`] },
      {
        value: 'sharp',
        label: 'Sharp',
        presets: [`${SLANG}/pixel-art-scaling/sharp-bilinear.slangp`, `${SLANG}/pixel-art-scaling/sharp-bilinear-simple.slangp`, `${SLANG}/interpolation/sharp-bilinear.slangp`]
      }
    ]
  }),
  'retroarch.aspect': choice({
    title: 'Aspect ratio',
    control: 'picker',
    default: 'core',
    options: [
      { value: 'core', label: 'As the system intended', cfg: { aspect_ratio_index: '22' } }, // ASPECT_RATIO_CORE
      { value: '4:3', label: '4:3', cfg: { aspect_ratio_index: '0' } },
      { value: '16:9', label: '16:9', cfg: { aspect_ratio_index: '1' } },
      { value: 'stretch', label: 'Stretch to fill', cfg: { aspect_ratio_index: '24' } } // ASPECT_RATIO_FULL
    ]
  }),
  'retroarch.integerScale': toggle({
    title: 'Integer scaling',
    description: 'Scales by whole numbers only, for perfectly even pixels with small borders.',
    default: false,
    cfg: ['video_scale_integer']
  }),
  'retroarch.videoDriver': choice({
    title: 'Video driver',
    description: 'Vulkan is fastest on most GPUs. Try another driver if a game shows a black screen.',
    control: 'picker',
    default: 'vulkan',
    options: [
      { value: 'vulkan', label: 'Vulkan', cfg: { video_driver: 'vulkan' } },
      { value: 'glcore', label: 'OpenGL', cfg: { video_driver: 'glcore' } },
      { value: 'd3d11', label: 'Direct3D 11', cfg: { video_driver: 'd3d11' }, os: 'windows' },
      { value: 'd3d12', label: 'Direct3D 12', cfg: { video_driver: 'd3d12' }, os: 'windows' },
      { value: 'metal', label: 'Metal', cfg: { video_driver: 'metal' }, os: 'macos' }
    ]
  }),
  'retroarch.showFps': toggle({ title: 'Show frame rate', default: false, cfg: ['fps_show'] }),
  'retroarch.autoSaveState': toggle({ title: 'Save a state when quitting', default: true, cfg: ['savestate_auto_save'] }),
  'retroarch.autoLoadState': toggle({ title: 'Load that state when starting', default: true, cfg: ['savestate_auto_load'] }),
  'retroarch.runAhead': toggle({ title: 'Run-ahead', description: 'Removes one frame of input lag. Uses more CPU.', default: false, cfg: ['run_ahead_enabled'] }),
  // No cfg: the button indices depend on the joypad driver (see buildRetroArchConfig).
  'retroarch.faceButtons': choice({
    title: 'Game buttons',
    description: 'Which face buttons the A and B of a NES or Super NES game are on.',
    control: 'segmented',
    default: 'position',
    options: [
      { value: 'position', label: 'Like the original pad', hint: 'A is the right button, B the bottom one' },
      { value: 'labels', label: 'Match the labels', hint: 'A is the button labeled A on your controller' }
    ]
  }),
  // No cfg: whether rewind is really on also depends on RetroAchievements hardcore mode (see buildRetroArchConfig).
  'retroarch.rewind': toggle({ title: 'Rewind', description: 'Lets you step back a few seconds from the quick menu. Uses more memory.', default: false }),

  'retroAchievements.enabled': toggle({ title: 'Enable RetroAchievements', default: false }),
  'retroAchievements.hardcore': toggle({
    title: 'Hardcore mode',
    description: 'Disables save states, rewind and slow motion so unlocks count as hardcore.',
    default: false
  }),

  'performance.inGameMode': choice({
    title: 'While a game is running',
    control: 'segmented',
    default: 'unchanged',
    options: [
      { value: 'quiet', label: 'Quiet', hint: 'Power saver. Cool and silent, fine for 8 and 16-bit.' },
      { value: 'balanced', label: 'Balanced', hint: 'The Balanced power plan. Right for most systems.' },
      { value: 'performance', label: 'Performance', hint: 'High performance plan for PS2, GameCube and Switch.' },
      { value: 'unchanged', label: 'Leave as is', hint: 'Keep whatever power plan is in use.' }
    ]
  }),

  'scraping.autoFetchArtwork': toggle({
    title: 'Download artwork automatically',
    description: 'Fetch box art and screenshots from libretro-thumbnails after each scan.',
    default: true
  }),
  'scraping.preferredRegion': choice({
    title: 'Preferred region',
    description: 'Used when a game has artwork for several regions.',
    control: 'picker',
    default: 'USA',
    options: [
      { value: 'USA', label: 'USA' },
      { value: 'Europe', label: 'Europe' },
      { value: 'Japan', label: 'Japan' },
      { value: 'World', label: 'World' }
    ]
  })
}

export type SettingPath = keyof typeof SETTINGS_SCHEMA
export type SettingDef = ChoiceSetting | ToggleSetting
/** The type a setting holds: the union of its option values, or boolean for a switch. */
export type SettingValue<P extends SettingPath> = (typeof SETTINGS_SCHEMA)[P] extends ChoiceSetting<infer T> ? T : boolean

export const settingDef = (path: string): SettingDef | undefined => (Object.hasOwn(SETTINGS_SCHEMA, path) ? (SETTINGS_SCHEMA as Record<string, SettingDef>)[path] : undefined)
export const settingDefault = <P extends SettingPath>(path: P): SettingValue<P> => SETTINGS_SCHEMA[path].default as SettingValue<P>

/** The options of a choice setting, typed by its values. With `os`, only those offered on that OS. */
export function settingOptions<P extends SettingPath>(path: P, os?: HostOs): readonly Choice<SettingValue<P> & string>[] {
  const d: SettingDef = SETTINGS_SCHEMA[path]
  const all = (d.kind === 'choice' ? d.options : []) as readonly Choice<SettingValue<P> & string>[]
  return os ? all.filter((o) => !o.os || o.os === os) : all
}

/** True when `value` is something this setting may hold. */
export function isValidSetting(def: SettingDef, value: unknown): boolean {
  return def.kind === 'toggle' ? typeof value === 'boolean' : def.options.some((o) => o.value === value)
}

export function getSetting<P extends SettingPath>(settings: Settings, path: P): SettingValue<P> {
  const [group, key] = path.split('.') as [keyof Settings, string]
  return (settings[group] as unknown as Record<string, unknown>)[key] as SettingValue<P>
}

/** The settings.set() patch that stores `value` at `path`. */
export function settingPatch<P extends SettingPath>(path: P, value: SettingValue<P>): Record<string, Record<string, unknown>> {
  const [group, key] = path.split('.') as [string, string]
  return { [group]: { [key]: value } }
}

/**
 * RetroArch config for every `retroarch.*` setting that declares one. An option not offered on `os` (settings
 * carried over from another machine) falls back to the setting's default.
 */
export function retroArchCfgFromSettings(settings: Settings, os?: HostOs): Record<string, string> {
  const cfg: Record<string, string> = {}
  for (const path of Object.keys(SETTINGS_SCHEMA) as SettingPath[]) {
    if (!path.startsWith('retroarch.')) continue
    const def: SettingDef = SETTINGS_SCHEMA[path]
    const value: unknown = getSetting(settings, path)
    if (def.kind === 'toggle') for (const k of def.cfg ?? []) cfg[k] = value ? 'true' : 'false'
    else {
      const chosen = def.options.find((o) => o.value === value && (!os || !o.os || o.os === os))
      Object.assign(cfg, chosen?.cfg ?? def.options.find((o) => o.value === def.default)?.cfg)
    }
  }
  return cfg
}
