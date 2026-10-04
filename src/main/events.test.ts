import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskProgress } from '../shared/types'

const sent = vi.hoisted(() => [] as TaskProgress[])

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_channel: string, p: TaskProgress) => sent.push(p) } }]
  }
}))

const { createTask } = await import('./events')

describe('createTask progress throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sent.length = 0
  })
  afterEach(() => vi.useRealTimers())

  it('sends at most one update per 100ms and then the latest value', () => {
    const t = createTask('Downloading')
    expect(sent).toHaveLength(1)
    t.update(0.1)
    t.update(0.2)
    t.update(0.3, 'almost')
    expect(sent).toHaveLength(1)
    vi.advanceTimersByTime(100)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatchObject({ progress: 0.3, detail: 'almost', state: 'running' })
    vi.advanceTimersByTime(500)
    expect(sent).toHaveLength(2)
  })

  it('does not send a stale update after done()', () => {
    const t = createTask('Downloading')
    t.update(0.5)
    t.done('ok')
    vi.advanceTimersByTime(500)
    expect(sent.map((p) => p.state)).toEqual(['running', 'done'])
  })
})
