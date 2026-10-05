import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useTasks, useToasts } from '../stores/session'
import { ProgressBar, Spinner } from './Controls'

/** Bottom-right stack of background tasks (downloads, scans, artwork). */
export function TaskTray() {
  const tasks = useTasks((s) => s.tasks)
  const dismiss = useTasks((s) => s.dismiss)
  const list = Object.values(tasks)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(-4)
  if (!list.length) return null
  return (
    <div className="tasktray" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`task task--${t.state}`}>
          <div className="task__head">
            <span className="task__icon">{t.state === 'running' ? <Spinner size="sm" /> : t.state === 'error' ? <AlertTriangle size="1em" /> : <CheckCircle2 size="1em" />}</span>
            <span className="task__label">{t.label}</span>
            {t.state === 'running' && t.progress >= 0 && <span className="task__pct">{Math.round(t.progress * 100)}%</span>}
            {t.state !== 'running' && (
              <button type="button" tabIndex={-1} className="task__close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X size="0.9em" />
              </button>
            )}
          </div>
          {t.state === 'running' && <ProgressBar value={t.progress} />}
          {(t.error || t.detail) && <div className="task__detail">{t.state === 'error' ? t.error : t.detail}</div>}
        </div>
      ))}
    </div>
  )
}

export function Toasts({ className = '' }: { className?: string }) {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className={`toasts ${className}`} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`}>
          {t.kind === 'error' ? <AlertTriangle size="1.1em" /> : t.kind === 'success' ? <CheckCircle2 size="1.1em" /> : <Info size="1.1em" />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}
