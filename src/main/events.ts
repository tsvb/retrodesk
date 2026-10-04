import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { EVENTS } from '../shared/api'
import type { SessionInfo, TaskProgress, TaskSubject } from '../shared/types'

/** Send an event to every open window (main UI + overlay). */
export function broadcast(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

export const emitSession = (s: SessionInfo | null): void => broadcast(EVENTS.session, s)
export const emitLibraryChanged = (): void => broadcast(EVENTS.libraryChanged)

export interface TaskHandle {
  readonly id: string
  /** progress 0..1 or -1 for indeterminate. Throttled to ~10 updates/sec. */
  update(progress: number, detail?: string): void
  done(detail?: string): void
  fail(err: unknown): void
}

/** Create a background task whose progress is shown in the UI's task tray. */
export function createTask(label: string, subject?: TaskSubject): TaskHandle {
  const task: TaskProgress = { id: randomUUID(), label, subject, progress: -1, state: 'running' }
  let last = 0
  const send = (force = false) => {
    const now = Date.now()
    if (!force && now - last < 100) return
    last = now
    broadcast(EVENTS.task, { ...task })
  }
  send(true)
  return {
    id: task.id,
    update(progress, detail) {
      task.progress = progress
      if (detail !== undefined) task.detail = detail
      send()
    },
    done(detail) {
      task.state = 'done'
      task.progress = 1
      if (detail !== undefined) task.detail = detail
      send(true)
    },
    fail(err) {
      task.state = 'error'
      task.error = err instanceof Error ? err.message : String(err)
      send(true)
    }
  }
}
