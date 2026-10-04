import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { eventChannel, type ApiEvents, type EventName } from '../shared/api'
import type { SessionInfo, TaskProgress, TaskSubject } from '../shared/types'

/** An event's payload as an argument list: none for `void` events. */
type Payload<K extends EventName> = ApiEvents[K] extends void ? [] : [payload: ApiEvents[K]]

/** Send an event to one window. */
export function sendEvent<K extends EventName>(win: BrowserWindow, name: K, ...payload: Payload<K>): void {
  if (!win.isDestroyed()) win.webContents.send(eventChannel(name), ...payload)
}

/** Send an event to every open window (main UI + overlay). */
export function broadcast<K extends EventName>(name: K, ...payload: Payload<K>): void {
  for (const w of BrowserWindow.getAllWindows()) sendEvent(w, name, ...payload)
}

export const emitSession = (s: SessionInfo | null): void => broadcast('session', s)
export const emitLibraryChanged = (): void => broadcast('libraryChanged')

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
  let trailing: NodeJS.Timeout | undefined
  const send = (force = false) => {
    const now = Date.now()
    if (!force && now - last < 100) {
      // Throttled: still deliver the latest value once the window is over, in case no further update comes.
      trailing ??= setTimeout(() => send(true), 100 - (now - last))
      return
    }
    clearTimeout(trailing)
    trailing = undefined
    last = now
    broadcast('task', { ...task })
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
