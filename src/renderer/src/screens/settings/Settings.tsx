import { useState, type ReactNode } from 'react'
import { Cpu, FolderOpen, Gamepad2, Gauge, Info, KeyRound, MonitorPlay, Palette, Trophy, type LucideIcon } from 'lucide-react'
import { focusManager } from '../../input/focus'
import { useFocusable, useFocusGroup } from '../../input/hooks'
import { useInputStore } from '../../stores/input'
import type { SettingsTab } from '../../stores/nav'
import { AboutTab } from './AboutTab'
import { AchievementsTab } from './AchievementsTab'
import { BiosTab } from './BiosTab'
import { ControlsTab } from './ControlsTab'
import { DisplayTab } from './DisplayTab'
import { EmulatorsTab } from './EmulatorsTab'
import { InGameTab } from './InGameTab'
import { LibraryTab } from './LibraryTab'
import { PerformanceTab } from './PerformanceTab'

const SECTIONS: { id: SettingsTab; label: string; icon: LucideIcon; render: () => ReactNode }[] = [
  { id: 'library', label: 'Library', icon: FolderOpen, render: () => <LibraryTab /> },
  { id: 'emulators', label: 'Emulators', icon: Cpu, render: () => <EmulatorsTab /> },
  { id: 'bios', label: 'BIOS', icon: KeyRound, render: () => <BiosTab /> },
  { id: 'controls', label: 'Controls', icon: Gamepad2, render: () => <ControlsTab /> },
  { id: 'display', label: 'Display & theme', icon: Palette, render: () => <DisplayTab /> },
  { id: 'ingame', label: 'In-game', icon: MonitorPlay, render: () => <InGameTab /> },
  { id: 'performance', label: 'Performance', icon: Gauge, render: () => <PerformanceTab /> },
  { id: 'achievements', label: 'RetroAchievements', icon: Trophy, render: () => <AchievementsTab /> },
  { id: 'about', label: 'About', icon: Info, render: () => <AboutTab /> }
]

export function SettingsScreen({ initialTab }: { initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'library')
  useFocusGroup('settings-nav', { memory: true })
  const section = SECTIONS.find((s) => s.id === tab) ?? SECTIONS[0]
  return (
    <div className="screen screen--settings">
      <nav className="settings-nav" aria-label="Settings sections">
        <h1 className="settings-nav__title">Settings</h1>
        {SECTIONS.map((s) => (
          <NavItem key={s.id} id={s.id} label={s.label} icon={s.icon} active={s.id === tab} autoFocus={s.id === tab} onSelect={() => setTab(s.id)} />
        ))}
      </nav>
      <div className="settings-body" key={tab}>
        <h2 className="settings-body__title">{section?.label}</h2>
        {section?.render()}
      </div>
    </div>
  )
}

function enterBody(): boolean {
  const first = document.querySelector<HTMLElement>('.layer.is-top .settings-body [data-fid]')
  const id = first?.dataset.fid
  if (!id) return false
  focusManager.focus(id, { source: useInputStore.getState().source })
  return true
}

function NavItem({ label, icon: Icon, active, autoFocus, onSelect }: { id: SettingsTab; label: string; icon: LucideIcon; active: boolean; autoFocus: boolean; onSelect: () => void }) {
  const { props } = useFocusable<HTMLDivElement>({
    group: 'settings-nav',
    autoFocus,
    label: 'Open',
    // Moving over a section previews it; confirm jumps into its options.
    onFocus: (source) => {
      if (source !== 'mouse') onSelect()
    },
    // Right (or confirm) enters the section at its first option rather than the geometrically nearest one.
    handleDirection: (dir) => (dir === 'right' ? enterBody() : false),
    onActivate: () => {
      onSelect()
      requestAnimationFrame(() => requestAnimationFrame(() => enterBody()))
    }
  })
  return (
    <div className={`settings-nav__item ${active ? 'is-active' : ''}`} role="tab" aria-selected={active} {...props}>
      <Icon size="1.15em" />
      <span>{label}</span>
    </div>
  )
}

/** A titled block within a settings page. */
export function Section({ title, description, children, aside }: { title?: string; description?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="settings-section">
      {(title || aside) && (
        <header className="settings-section__head">
          {title && <h3>{title}</h3>}
          {aside}
        </header>
      )}
      {description && <p className="settings-section__desc">{description}</p>}
      <div className="settings-section__body">{children}</div>
    </section>
  )
}
