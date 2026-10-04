import { ToggleRow } from '../../components/Controls'
import { SchemaSetting } from '../../components/SchemaSetting'
import { useSettings, useSettingsValue } from '../../stores/settings'
import { Section } from './Settings'

export function InGameTab() {
  const ra = useSettingsValue().retroarch
  const update = useSettings((st) => st.update)
  return (
    <>
      <p className="settings-body__intro">These options are written to RetroArch before each game starts. Standalone emulators keep their own settings.</p>
      <Section title="Picture">
        <SchemaSetting path="retroarch.shader" />
        <SchemaSetting path="retroarch.aspect" />
        <SchemaSetting path="retroarch.integerScale" />
        <SchemaSetting path="retroarch.videoDriver" />
        <SchemaSetting path="retroarch.showFps" />
      </Section>
      <Section title="Play">
        {/* One switch for the two settings that make up quick resume. */}
        <ToggleRow
          title="Quick resume"
          description="Saves a state when you quit and loads it next time, so every game continues exactly where you left off."
          value={ra.autoSaveState && ra.autoLoadState}
          onChange={(v) => void update({ retroarch: { autoSaveState: v, autoLoadState: v } })}
        />
        <SchemaSetting path="retroarch.runAhead" />
        <SchemaSetting path="retroarch.rewind" />
      </Section>
    </>
  )
}
