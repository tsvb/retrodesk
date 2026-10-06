import { getSetting, SETTINGS_SCHEMA, settingOptions, settingPatch, type SettingDef, type SettingPath, type SettingValue } from '@shared/settingsSchema'
import type { DeepPartial } from '@shared/api'
import type { Settings } from '@shared/types'
import { hostOs } from '../lib/platform'
import { useSettings, useSettingsValue } from '../stores/settings'
import { PickerRow, Segmented, SettingRow, ToggleRow, type Option } from './Controls'

/** Read a schema setting and get a setter that persists it. */
export function useSetting<P extends SettingPath>(path: P): [SettingValue<P>, (v: SettingValue<P>) => void] {
  const value = getSetting(useSettingsValue(), path)
  const update = useSettings((s) => s.update)
  return [value, (v) => void update(settingPatch(path, v) as DeepPartial<Settings>)]
}

/** A choice setting as a bare segmented control, for sections that supply their own heading. */
export function SchemaSegmented<P extends SettingPath>({ path, size }: { path: P; size?: 'md' | 'lg' }) {
  const [value, set] = useSetting(path)
  return (
    <Segmented
      group={`setting-${path}`}
      size={size}
      value={value as string}
      onChange={(v) => set(v as SettingValue<P>)}
      options={settingOptions(path, hostOs) as readonly Option<string>[] as Option<string>[]}
    />
  )
}

/**
 * The row for a setting, built from its SETTINGS_SCHEMA entry: a switch, a segmented control or a picker,
 * with the title and description declared there.
 */
export function SchemaSetting<P extends SettingPath>({ path, disabled }: { path: P; disabled?: boolean }) {
  const def: SettingDef = SETTINGS_SCHEMA[path]
  const [value, set] = useSetting(path)
  if (def.kind === 'toggle') return <ToggleRow title={def.title} description={def.description} value={value as boolean} disabled={disabled} onChange={(v) => set(v as SettingValue<P>)} />
  if (def.control === 'segmented') {
    return (
      <SettingRow title={def.title} description={def.description}>
        <SchemaSegmented path={path} />
      </SettingRow>
    )
  }
  return (
    <PickerRow
      title={def.title}
      description={def.description}
      value={value as string}
      disabled={disabled}
      options={settingOptions(path, hostOs) as readonly Option<string>[] as Option<string>[]}
      onChange={(v) => set(v as SettingValue<P>)}
    />
  )
}
