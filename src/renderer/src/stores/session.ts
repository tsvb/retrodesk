import { create } from 'zustand'
import type { SessionInfo, TaskProgress, TaskSubject } from '@shared/types'

interface SessionState {
  session: SessionInfo | null
  set(s: SessionInfo | null): void
}

export const useSession = create<SessionState>((set) => ({
  session: null,
  set: (session) => set({ session })
}))

/**
 * Keep `html.game-idle` on while a game runs and this window is in the background. The window sits behind the game
 * but is never "hidden" to Chromium (see main/index.ts), so CSS animations would keep running; base.css pauses
 * them under this class. Gated on focus too, so anything that starts while the game runs (Now Playing's fade-in)
 * still plays once the window is brought back.
 */
export function followGameIdle(): () => void {
  const sync = () => document.documentElement.classList.toggle('game-idle', !!useSession.getState().session && !document.hasFocus())
  sync()
  const off = useSession.subscribe(sync)
  window.addEventListener('focus', sync)
  window.addEventListener('blur', sync)
  return () => {
    off()
    window.removeEventListener('focus', sync)
    window.removeEventListener('blur', sync)
    document.documentElement.classList.remove('game-idle')
  }
}

export interface TrackedTask extends TaskProgress {
  updatedAt: number
}

interface TasksState {
  tasks: Record<string, TrackedTask>
  upsert(t: TaskProgress): void
  dismiss(id: string): void
}

const DONE_TTL = 3500
const ERROR_TTL = 15000

export const useTasks = create<TasksState>((set, get) => ({
  tasks: {},
  upsert(t) {
    set((s) => ({ tasks: { ...s.tasks, [t.id]: { ...t, updatedAt: Date.now() } } }))
    if (t.state !== 'running' && !t.sticky) {
      const ttl = t.state === 'error' ? ERROR_TTL : DONE_TTL
      setTimeout(() => {
        const cur = get().tasks[t.id]
        if (cur && cur.state !== 'running' && Date.now() - cur.updatedAt >= ttl - 50) get().dismiss(t.id)
      }, ttl)
    }
  },
  dismiss(id) {
    set((s) => {
      const next = { ...s.tasks }
      delete next[id]
      return { tasks: next }
    })
  }
}))

export const selectRunning = (s: TasksState): TrackedTask[] => Object.values(s.tasks).filter((t) => t.state === 'running')

/**
 * Find the running task for a subject. Tasks that carry `subject` are matched by kind (and id when given);
 * tasks without one (older backends) fall back to a label test.
 */
export function findRunningTask(s: TasksState, match: { kinds: TaskSubject['kind'][]; id?: string; ids?: string[] }, fallback: (label: string) => boolean): TrackedTask | undefined {
  const running = selectRunning(s)
  const wanted = match.ids ?? (match.id !== undefined ? [match.id] : undefined)
  const bySubject = running.find((t) => t.subject && match.kinds.includes(t.subject.kind) && (!wanted || (t.subject.id !== undefined && wanted.includes(t.subject.id))))
  return bySubject ?? running.find((t) => !t.subject && fallback(t.label))
}

export type ToastKind = 'info' | 'success' | 'error'
export interface Toast {
  id: number
  kind: ToastKind
  text: string
}

interface ToastState {
  toasts: Toast[]
  push(text: string, kind?: ToastKind): void
}

let toastSeq = 0
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push(text, kind = 'info') {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 2800)
  }
}))

export const toast = (text: string, kind?: ToastKind): void => useToasts.getState().push(text, kind)
