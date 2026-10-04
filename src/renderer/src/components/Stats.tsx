import type { SystemStats } from '@shared/types'
import { formatBytes } from '../lib/format'
import { Spinner } from './Controls'

/** One live meter: label, value in text ink, a thin bar in the accent. Warn/critical only by threshold. */
export function Meter({ label, value, fraction, detail, level = 'normal' }: { label: string; value: string; fraction?: number; detail?: string; level?: 'normal' | 'warn' | 'critical' }) {
  return (
    <div className={`meter meter--${level}`}>
      <div className="meter__head">
        <span className="meter__label">{label}</span>
        <span className="meter__value">{value}</span>
      </div>
      {fraction !== undefined && (
        <div className="meter__track">
          <div className="meter__fill" style={{ transform: `scaleX(${Math.max(0.01, Math.min(1, fraction))})` }} />
        </div>
      )}
      {detail && <span className="meter__detail">{detail}</span>}
    </div>
  )
}

const tempLevel = (c: number) => (c >= 85 ? 'critical' : c >= 75 ? 'warn' : 'normal')

export function StatsCard({ stats, compact = false }: { stats: SystemStats | null; compact?: boolean }) {
  if (!stats)
    return (
      <div className="stats-card is-loading">
        <Spinner />
      </div>
    )
  const mem = stats.memTotalBytes ? stats.memUsedBytes / stats.memTotalBytes : 0
  return (
    <div className={`stats-card ${compact ? 'stats-card--compact' : ''}`}>
      <Meter label="CPU" value={`${Math.round(stats.cpuPercent)}%`} fraction={stats.cpuPercent / 100} level={stats.cpuPercent > 92 ? 'warn' : 'normal'} />
      <Meter label="Memory" value={`${Math.round(mem * 100)}%`} fraction={mem} detail={compact ? undefined : `${formatBytes(stats.memUsedBytes)} of ${formatBytes(stats.memTotalBytes)}`} />
      {stats.gpu && (
        <>
          <Meter label="GPU" value={`${Math.round(stats.gpu.utilPercent)}%`} fraction={stats.gpu.utilPercent / 100} detail={compact ? undefined : stats.gpu.name} />
          <Meter
            label={compact ? 'GPU temp' : 'GPU temperature'}
            value={`${Math.round(stats.gpu.tempC)}°C${tempLevel(stats.gpu.tempC) === 'critical' ? ', hot' : tempLevel(stats.gpu.tempC) === 'warn' ? ', warm' : ''}`}
            fraction={stats.gpu.tempC / 100}
            level={tempLevel(stats.gpu.tempC)}
          />
          {!compact && (
            <Meter
              label="Video memory"
              value={`${Math.round((stats.gpu.memUsedMB / Math.max(1, stats.gpu.memTotalMB)) * 100)}%`}
              fraction={stats.gpu.memUsedMB / Math.max(1, stats.gpu.memTotalMB)}
              detail={`${(stats.gpu.memUsedMB / 1024).toFixed(1)} GB of ${(stats.gpu.memTotalMB / 1024).toFixed(1)} GB`}
            />
          )}
        </>
      )}
      {stats.battery && (
        <Meter
          label="Battery"
          value={`${Math.round(stats.battery.percent)}%${stats.battery.charging ? ', charging' : ''}`}
          fraction={stats.battery.percent / 100}
          level={!stats.battery.charging && stats.battery.percent <= 15 ? 'critical' : 'normal'}
        />
      )}
      {stats.powerPlan && !compact && <Meter label="Power plan" value={stats.powerPlan} />}
    </div>
  )
}
