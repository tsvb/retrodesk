/**
 * A shared concurrency gate: `limit(fn)` runs `fn` once fewer than `max` gated calls are in flight. Unlike mapLimit
 * it bounds work started from many places (e.g. every image download of an artwork run, whichever game asks).
 */
export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>

export function createLimiter(max: number): Limiter {
  let active = 0
  const waiting: (() => void)[] = []
  // A finishing call hands its slot straight to the next waiter, so a newcomer cannot slip in between.
  const release = (): void => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((r) => waiting.push(r))
    else active++
    try {
      return await fn()
    } finally {
      release()
    }
  }
}
