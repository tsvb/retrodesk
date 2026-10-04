import { PickerRow, Segmented, SettingRow, ToggleRow } from '../../components/Controls'
import { useSettings, useSettingsValue } from '../../stores/settings'
import { Section } from './Settings'

export function InGameTab() {
  const s = useSettingsValue()
  const update = useSettings((st) => st.update)
  const ra = s.retroarch
  const set = (patch: Partial<typeof ra>) => void update({ retroarch: patch })
  return (
    <>
      <p className="settings-body__intro">These options are written to RetroArch before each game starts. Standalone emulators keep their own settings.</p>
      <Section title="Picture">
        <SettingRow title="Shader" description="CRT adds scanlines and glow, LCD imitates handheld pixel grids, Sharp keeps pixels crisp when scaling.">
          <Segmented
            group="shader"
            value={ra.shader}
            onChange={(v) => set({ shader: v })}
            options={[
              { value: 'none', label: 'None' },
              { value: 'crt', label: 'CRT' },
              { value: 'lcd', label: 'LCD' },
              { value: 'sharp', label: 'Sharp' }
            ]}
          />
        </SettingRow>
        <PickerRow
          title="Aspect ratio"
          value={ra.aspect}
          onChange={(v) => set({ aspect: v })}
          options={[
            { value: 'core', label: 'As the system intended' },
            { value: '4:3', label: '4:3' },
            { value: '16:9', label: '16:9' },
            { value: 'stretch', label: 'Stretch to fill' }
          ]}
        />
        <ToggleRow title="Integer scaling" description="Scales by whole numbers only, for perfectly even pixels with small borders." value={ra.integerScale} onChange={(v) => set({ integerScale: v })} />
        <PickerRow
          title="Video driver"
          description="Vulkan is fastest on most GPUs. Try Direct3D 11 if a game shows a black screen."
          value={ra.videoDriver}
          onChange={(v) => set({ videoDriver: v })}
          options={[
            { value: 'vulkan', label: 'Vulkan' },
            { value: 'glcore', label: 'OpenGL' },
            { value: 'd3d11', label: 'Direct3D 11' },
            { value: 'd3d12', label: 'Direct3D 12' }
          ]}
        />
        <ToggleRow title="Show frame rate" value={ra.showFps} onChange={(v) => set({ showFps: v })} />
      </Section>
      <Section title="Play">
        <ToggleRow
          title="Quick resume"
          description="Saves a state when you quit and loads it next time, so every game continues exactly where you left off."
          value={ra.autoSaveState && ra.autoLoadState}
          onChange={(v) => set({ autoSaveState: v, autoLoadState: v })}
        />
        <ToggleRow title="Run-ahead" description="Removes one frame of input lag. Uses more CPU." value={ra.runAhead} onChange={(v) => set({ runAhead: v })} />
        <ToggleRow title="Rewind" description="Lets you step back a few seconds from the quick menu. Uses more memory." value={ra.rewind} onChange={(v) => set({ rewind: v })} />
      </Section>
    </>
  )
}
