import { Check } from 'lucide-react'
import { settingOptions } from '@shared/settingsSchema'
import type { Settings } from '@shared/types'
import { SchemaSetting } from '../../components/SchemaSetting'
import { useFocusable, useFocusGroup } from '../../input/hooks'
import { feedback } from '../../lib/feedback'
import { useSettings, useSettingsValue } from '../../stores/settings'
import { Section } from './Settings'

type Theme = Settings['ui']['theme']

/** Preview swatches (background, surface, text) for each theme declared in the settings schema. */
const THEME_COLORS: Record<Theme, [string, string, string]> = {
  midnight: ['#0c0a1c', '#1b1838', '#f1eefc'],
  amoled: ['#000000', '#121217', '#f6f6f8'],
  light: ['#e9e7f2', '#ffffff', '#16132b'],
  retro: ['#0f150d', '#26341f', '#dff3b4']
}
const THEMES = settingOptions('ui.theme').map((t) => ({ value: t.value, label: t.label, colors: THEME_COLORS[t.value] }))

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
      <Section title="Accent color" description="Used for focus highlights, buttons and progress bars.">
        <div className="swatches">
          {ACCENTS.map((c) => (
            <Swatch key={c} color={c} selected={s.ui.accent.toLowerCase() === c} onSelect={() => void update({ ui: { accent: c } })} />
          ))}
        </div>
      </Section>
      <Section title="Layout">
        <SchemaSetting path="ui.density" />
        <SchemaSetting path="ui.hideEmptySystems" />
        <SchemaSetting path="ui.startFullscreen" />
        <SchemaSetting path="ui.sounds" />
        <SchemaSetting path="ui.haptics" />
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
    label: 'Use color',
    onActivate: () => {
      feedback('toggle')
      onSelect()
    }
  })
  return (
    <div className={`swatch ${selected ? 'is-selected' : ''}`} style={{ background: color }} role="radio" aria-checked={selected} aria-label={color} {...props}>
      {selected && <Check size="1.2em" strokeWidth={3} />}
    </div>
  )
}
