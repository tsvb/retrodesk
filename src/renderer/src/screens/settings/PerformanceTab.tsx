import { api } from '../../api'
import { SchemaSegmented } from '../../components/SchemaSetting'
import { StatsCard } from '../../components/Stats'
import { usePoll } from '../../lib/hooks'
import { useSession } from '../../stores/session'
import { Section } from './Settings'

/** Nobody is looking at the stats while the window is in the background or a game runs on top of it. */
const unseen = (): boolean => !document.hasFocus() || !!useSession.getState().session

export function PerformanceTab() {
  const stats = usePoll(() => api.system.getStats(), 2000, [], unseen)
  return (
    <>
      <Section
        title="While a game is running"
        description="Like the handheld's performance profiles: RetroDesk switches the Windows power plan when a game starts and restores it when you quit."
      >
        <SchemaSegmented path="performance.inGameMode" size="lg" />
      </Section>
      <Section title="This PC right now">
        <StatsCard stats={stats} />
      </Section>
    </>
  )
}
