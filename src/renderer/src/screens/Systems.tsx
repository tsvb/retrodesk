import { useCallback, useEffect } from 'react'
import type { SystemSummary } from '@shared/types'
import { SystemCard } from '../components/SystemCard'
import { useActions } from '../input/hooks'
import { systemColor } from '../lib/color'
import { plural } from '../lib/format'
import { useLibrary } from '../stores/library'
import { useNav } from '../stores/nav'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'

export function SystemsScreen() {
  const systems = useLibrary((s) => s.systems)
  const hideEmpty = useSettings((s) => s.settings?.ui.hideEmptySystems ?? true)
  const update = useSettings((s) => s.update)
  const push = useNav((s) => s.push)
  const setAmbient = useUi((s) => s.setAmbient)

  const shown = systems
    .filter((s) => !hideEmpty || s.gameCount > 0)
    .sort((a, b) => Number(b.gameCount > 0) - Number(a.gameCount > 0) || a.manufacturer.localeCompare(b.manufacturer) || a.year - b.year)
  const games = systems.reduce((n, s) => n + s.gameCount, 0)
  const hiddenCount = systems.length - systems.filter((s) => s.gameCount > 0).length

  useEffect(() => () => setAmbient(null), [setAmbient])
  useActions({
    view: { label: hideEmpty ? 'Show all systems' : 'Hide empty systems', run: () => void update({ ui: { hideEmptySystems: !hideEmpty } }) }
  })

  const open = useCallback((s: SystemSummary) => push({ name: 'games', systemId: s.id }), [push])
  const focus = useCallback((s: SystemSummary) => setAmbient(systemColor(s)), [setAmbient])

  return (
    <div className="screen screen--systems">
      <header className="page-head">
        <h1 className="page-head__title">Systems</h1>
        <p className="page-head__sub">
          {plural(games, 'game')} across {plural(systems.filter((s) => s.gameCount > 0).length, 'system')}
          {hideEmpty && hiddenCount > 0 ? `. ${hiddenCount} without games are hidden.` : ''}
        </p>
      </header>
      {shown.length === 0 ? (
        <p className="muted">No systems have games yet. Add a ROM folder in Settings.</p>
      ) : (
        <div className="cart-grid">
          {shown.map((s, i) => (
            <SystemCard key={s.id} system={s} group="systems-grid" autoFocus={i === 0} onActivate={open} onFocus={focus} />
          ))}
        </div>
      )}
    </div>
  )
}
