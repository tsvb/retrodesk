import { useState } from 'react'
import { Gamepad2 } from 'lucide-react'
import { Button } from '../../components/Button'
import { KeyCap, PadButton } from '../../components/Glyph'
import { Segmented, SettingRow } from '../../components/Controls'
import { ControllerTester } from '../../components/ControllerTester'
import { SchemaSegmented } from '../../components/SchemaSetting'
import { useInputStore } from '../../stores/input'
import { useSettings, useSettingsValue } from '../../stores/settings'
import { Section } from './Settings'
import { acceleratorKeys } from '../../lib/platform'

const COMBOS: { value: string; label: string; buttons: number[] }[] = [
  { value: '8,9', label: 'Back + Start', buttons: [8, 9] },
  { value: '10,11', label: 'L3 + R3', buttons: [10, 11] },
  { value: '4,5,9', label: 'LB + RB + Start', buttons: [4, 5, 9] }
]

export function ControlsTab() {
  const settings = useSettingsValue()
  const update = useSettings((s) => s.update)
  const pads = useInputStore((s) => s.pads)
  const [testing, setTesting] = useState(false)
  const family = pads[0]?.family ?? 'xbox'
  const comboKey = settings.hotkeys.quickMenuCombo.join(',')
  const accel = acceleratorKeys(settings.hotkeys.quickMenu)

  return (
    <>
      <Section title="Controllers">
        {pads.length === 0 ? (
          <p className="muted">No controller detected. Connect one and press any button; keyboard and mouse work in the meantime.</p>
        ) : (
          pads.map((p) => (
            <SettingRow
              key={p.index}
              title={p.id.replace(/\(.*?Vendor.*?\)/i, '').trim() || 'Controller'}
              description={`Player ${p.index + 1}, ${p.family === 'generic' ? 'standard' : p.family} layout`}
            />
          ))
        )}
        <div className="button-row">
          <Button icon={Gamepad2} onPress={() => setTesting(true)}>
            Test controller
          </Button>
        </div>
      </Section>

      <Section title="Button layout" description="Which face button confirms. Nintendo layout puts confirm on the right button, like a Switch or a Retroid in retro mode.">
        <SchemaSegmented path="ui.buttonLayout" size="lg" />
        <div className="layout-preview">
          <span>
            <PadButton family={family} index={settings.ui.buttonLayout === 'nintendo' ? 1 : 0} /> Confirm
          </span>
          <span>
            <PadButton family={family} index={settings.ui.buttonLayout === 'nintendo' ? 0 : 1} /> Back
          </span>
        </div>
      </Section>

      <Section title="In-game quick menu" description="Opens Game Assist on top of the running game: save and load states, screenshots, performance and quitting.">
        <SettingRow title="Controller combo" description="Hold together for half a second. The Guide / Home button always works too.">
          <Segmented
            group="ctl-combo"
            value={COMBOS.some((c) => c.value === comboKey) ? comboKey : '8,9'}
            onChange={(v) => void update({ hotkeys: { quickMenuCombo: COMBOS.find((c) => c.value === v)?.buttons ?? [8, 9] } })}
            options={COMBOS.map((c) => ({ value: c.value, label: c.label }))}
          />
        </SettingRow>
        <SettingRow title="Keyboard shortcut" description="Works while any emulator is in front.">
          <span className="keys">
            {accel.map((k) => (
              <KeyCap key={k} label={k} />
            ))}
          </span>
        </SettingRow>
      </Section>

      <Section title="Keyboard" description="Everything can be driven from a keyboard.">
        <dl className="keymap">
          {[
            [['↑', '↓', '←', '→'], 'Move'],
            [['Enter'], 'Select'],
            [['Esc'], 'Back'],
            [['F'], 'Favourite'],
            [['/'], 'Search'],
            [['Q', 'E'], 'Switch section'],
            [['Z', 'C'], 'Jump letter or page'],
            [['Tab'], 'View options'],
            [['M'], 'Menu'],
            [['F11'], 'Full screen']
          ].map(([keys, label]) => (
            <div key={label as string}>
              <dt>
                {(keys as string[]).map((k) => (
                  <KeyCap key={k} label={k} size="sm" />
                ))}
              </dt>
              <dd>{label as string}</dd>
            </div>
          ))}
        </dl>
      </Section>
      {testing && <ControllerTester onClose={() => setTesting(false)} />}
    </>
  )
}
