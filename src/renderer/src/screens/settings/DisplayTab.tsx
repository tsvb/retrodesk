import { Check } from 'lucide-react'
import type { Settings } from '@shared/types'
import { Segmented, SettingRow, ToggleRow } from '../../components/Controls'
import { useFocusable, useFocusGroup } from '../../input/hooks'
import { playSound } from '../../lib/sound'
import { useSettings, useSettingsValue } from '../../stores/settings'
import { Section } from './Settings'

type Theme = Settings['ui']['theme']

const THEMES: { value: Theme; label: string; colors: [string, string, string] }[] = [
  { value: 'midnight', label: 'Midnight', colors: ['#0c0a1c', '#1b1838', '#f1eefc'] },
  { value: 'amoled', label: 'AMOLED black', colors: ['#000000', '#121217', '#f6f6f8'] },
  { value: 'light', label: 'Daylight', colors: ['#e9e7f2', '#ffffff', '#16132b'] },
  { value: 'retro', label: 'Dot matrix', colors: ['#0f150d', '#26341f', '#dff3b4'] }
]

export const ACCENTS = ['#7c5cff', '#ff4f8b', '#ff8a3d', '#f5c400', '#2fd39a', '#25b9f0', '#4c6fff', '#e5484d']

export function DisplayTab() {
  const s = useSettingsValue()
  const update = useSettings((st) => st.update)
  useFocusGroup('themes', { memory: false })
  useFocusGroup('accents', { memory: false })
  return (
    <>
      <Section title="Theme">
        <div className="theme-grid">
          {THEMES.map((t) => (
            <ThemeTile key={t.value} theme={t} selected={s.ui.theme === t.value} onSelect={() => void update({ ui: { theme: t.value } })} />
          ))}
        </div>
      </Section>
      <Section title="Accent colour" description="Used for focus highlights, buttons and progress bars.">
        <div className="swatches">
          {ACCENTS.map((c) => (
            <Swatch key={c} color={c} selected={s.ui.accent.toLowerCase() === c} onSelect={() => void update({ ui: { accent: c } })} />
          ))}
        </div>
      </Section>
      <Section title="Layout">
        <SettingRow title="Game grid density" description="Comfortable is sized for a TV across the room; compact fits more covers on a desk monitor.">
          <Segmented
            group="density"
            value={s.ui.density}
            onChange={(v) => void update({ ui: { density: v } })}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' }
            ]}
          />
        </SettingRow>
        <ToggleRow title="Hide systems without games" value={s.ui.hideEmptySystems} onChange={(v) => void update({ ui: { hideEmptySystems: v } })} />
        <ToggleRow title="Start in full screen" description="Recommended on a TV. F11 switches at any time." value={s.ui.startFullscreen} onChange={(v) => void update({ ui: { startFullscreen: v } })} />
        <ToggleRow title="Interface sounds" description="Soft clicks when moving and selecting." value={s.ui.sounds} onChange={(v) => void update({ ui: { sounds: v } })} />
      </Section>
    </>
  )
}

function ThemeTile({ theme, selected, onSelect }: { theme: (typeof THEMES)[number]; selected: boolean; onSelect: () => void }) {
  const { props } = useFocusable<HTMLDivElement>({ group: 'themes', label: 'Use theme', onActivate: onSelect })
  const [bg, surface, text] = theme.colors
  return (
    <div className={`theme-tile ${selected ? 'is-selected' : ''}`} role="radio" aria-checked={selected} {...props}>
      <div className="theme-tile__preview" style={{ background: bg }}>
        <span style={{ background: surface }} />
        <span style={{ background: surface }} />
        <i style={{ background: text }} />
        <b style={{ background: 'var(--accent)' }} />
      </div>
      <span className="theme-tile__label">
        {theme.label}
        {selected && <Check size="1em" />}
      </span>
    </div>
  )
}

function Swatch({ color, selected, onSelect }: { color: string; selected: boolean; onSelect: () => void }) {
  const { props } = useFocusable<HTMLDivElement>({
    group: 'accents',
    label: 'Use colour',
    onActivate: () => {
      playSound('toggle')
      onSelect()
    }
  })
  return (
    <div className={`swatch ${selected ? 'is-selected' : ''}`} style={{ background: color }} role="radio" aria-checked={selected} aria-label={color} {...props}>
      {selected && <Check size="1.2em" strokeWidth={3} />}
    </div>
  )
}
