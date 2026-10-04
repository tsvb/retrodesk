import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, Gamepad2, Keyboard } from 'lucide-react'
import { isElectron } from '../api'
import { useBattery, useNow } from '../lib/hooks'
import { formatClock } from '../lib/format'
import { useInputStore } from '../stores/input'
import { currentTab, TABS, useNav } from '../stores/nav'
import { selectRunning, useTasks } from '../stores/session'
import { useUi } from '../stores/ui'
import { Glyph } from './Glyph'
import { Spinner } from './Controls'
import { feedback } from '../lib/feedback'

export function Wordmark() {
  return (
    <span className="wordmark" aria-label="RetroDesk">
      <span className="wordmark__mark" aria-hidden="true">
        <span />
        <span />
      </span>
      <span className="wordmark__text">RetroDesk</span>
    </span>
  )
}

export function StatusCluster() {
  const now = useNow()
  const battery = useBattery()
  const pads = useInputStore((s) => s.pads)
  const running = useTasks((s) => selectRunning(s).length)
  const BatteryIcon = battery?.charging ? BatteryCharging : (battery?.percent ?? 100) > 70 ? BatteryFull : (battery?.percent ?? 100) > 30 ? BatteryMedium : BatteryLow
  return (
    <div className="status">
      {running > 0 && (
        <span className="status__item status__tasks" title={`${running} task${running === 1 ? '' : 's'} running`}>
          <Spinner size="sm" />
          <span>{running}</span>
        </span>
      )}
      <span className={`status__item ${pads.length ? 'is-on' : 'is-off'}`} title={pads[0]?.id ?? 'No controller connected'}>
        {pads.length ? <Gamepad2 size="1.2em" /> : <Keyboard size="1.2em" />}
        {pads.length > 1 && <span>{pads.length}</span>}
      </span>
      {battery && (
        <span className={`status__item ${battery.percent <= 20 && !battery.charging ? 'is-low' : ''}`} title={`${battery.percent}%${battery.charging ? ', charging' : ''}`}>
          <BatteryIcon size="1.3em" />
          <span>{battery.percent}%</span>
        </span>
      )}
      <span className="status__clock">{formatClock(now)}</span>
    </div>
  )
}

export function TopBar() {
  const tab = useNav(currentTab)
  const switchTab = useNav((s) => s.switchTab)
  const fullscreen = useUi((s) => s.fullscreen)
  return (
    <header className={`topbar ${isElectron && !fullscreen ? 'is-windowed' : ''}`}>
      <Wordmark />
      <nav className="tabs" aria-label="Sections">
        <span className="tabs__glyph">
          <Glyph action="tabPrev" size="sm" />
        </span>
        {TABS.map((t) => (
          <button
            key={t.name}
            type="button"
            tabIndex={-1}
            className={`tabs__tab ${tab === t.name ? 'is-active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              feedback('toggle')
              switchTab(t.name)
            }}
          >
            {t.label}
          </button>
        ))}
        <span className="tabs__glyph">
          <Glyph action="tabNext" size="sm" />
        </span>
      </nav>
      <StatusCluster />
    </header>
  )
}
