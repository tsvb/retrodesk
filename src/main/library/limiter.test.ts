import { describe, expect, it } from 'vitest'
import { createLimiter } from './limiter'
import { sleep } from './util'

describe('createLimiter', () => {
  it('never runs more than max calls at once, and runs them all', async () => {
    const limit = createLimiter(3)
    let active = 0
    let peak = 0
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        limit(async () => {
          active++
          peak = Math.max(peak, active)
          await sleep(i % 3)
          active--
          return i
        })
      )
    )
    expect(peak).toBe(3)
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  it('frees the slot when a call fails', async () => {
    const limit = createLimiter(1)
    await expect(limit(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(await limit(async () => 'next')).toBe('next')
  })

  it('does not let a newcomer overtake a waiter that was just handed a slot', async () => {
    const limit = createLimiter(1)
    let active = 0
    let peak = 0
    const job = (): Promise<void> =>
      limit(async () => {
        active++
        peak = Math.max(peak, active)
        await sleep(1)
        active--
      })
    const first = job()
    const second = job()
    await first
    // `second` has been handed the slot but not resumed yet; this one must wait.
    await Promise.all([second, job()])
    expect(peak).toBe(1)
  })
})
