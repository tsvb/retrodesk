import { api } from '../../api'
import { SchemaSegmented } from '../../components/SchemaSetting'
import { StatsCard } from '../../components/Stats'
import { usePoll } from '../../lib/hooks'
import { Section } from './Settings'

export function PerformanceTab() {
  const stats = usePoll(() => api.system.getStats(), 2000)
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
