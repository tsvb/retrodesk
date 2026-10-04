import type { PerformanceMode } from '@shared/types'
import { api } from '../../api'
import { Segmented } from '../../components/Controls'
import { StatsCard } from '../../components/Stats'
import { usePoll } from '../../lib/hooks'
import { useSettings, useSettingsValue } from '../../stores/settings'
import { Section } from './Settings'

export const PERF_OPTIONS: { value: PerformanceMode; label: string; hint: string }[] = [
  { value: 'quiet', label: 'Quiet', hint: 'Power saver. Cool and silent, fine for 8 and 16-bit.' },
  { value: 'balanced', label: 'Balanced', hint: 'Windows Balanced plan. Right for most systems.' },
  { value: 'performance', label: 'Performance', hint: 'High performance plan for PS2, GameCube and Switch.' },
  { value: 'unchanged', label: 'Leave as is', hint: 'Keep whatever Windows is using.' }
]

export function PerformanceTab() {
  const s = useSettingsValue()
  const update = useSettings((st) => st.update)
  const stats = usePoll(() => api.system.getStats(), 2000)
  return (
    <>
      <Section
        title="While a game is running"
        description="Like the handheld's performance profiles: RetroDesk switches the Windows power plan when a game starts and restores it when you quit."
      >
        <Segmented group="perf-mode" size="lg" value={s.performance.inGameMode} onChange={(v) => void update({ performance: { inGameMode: v } })} options={PERF_OPTIONS} />
      </Section>
      <Section title="This PC right now">
        <StatsCard stats={stats} />
      </Section>
    </>
  )
}
