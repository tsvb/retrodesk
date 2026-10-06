// Tiny promise-based concurrency limiter shared by downloads, 7-Zip extractions and directory walks.

export interface Limiter {
  /** Run `fn` once a slot is free. `onQueued` fires if it has to wait; an aborted signal drops it from the queue. */
  <T>(fn: () => Promise<T>, opts?: { signal?: AbortSignal; onQueued?: () => void }): Promise<T>
  readonly active: number
  readonly waiting: number
}

export function createLimiter(max: number): Limiter {
  let active = 0
  const queue: (() => void)[] = []
  const release = () => {
    active--
    queue.shift()?.()
  }
  const acquire = (signal?: AbortSignal, onQueued?: () => void): Promise<void> => {
    if (signal?.aborted) return Promise.reject(abortReason(signal))
    if (active < max) {
      active++
      return Promise.resolve()
    }
    onQueued?.()
    return new Promise<void>((resolve, reject) => {
      const go = () => {
        signal?.removeEventListener('abort', onAbort)
        active++
        resolve()
      }
      const onAbort = () => {
        const i = queue.indexOf(go)
        if (i >= 0) queue.splice(i, 1)
        reject(abortReason(signal))
      }
      queue.push(go)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
  const run = (async <T>(fn: () => Promise<T>, opts: { signal?: AbortSignal; onQueued?: () => void } = {}): Promise<T> => {
    await acquire(opts.signal, opts.onQueued)
    try {
      return await fn()
    } finally {
      release()
    }
  }) as Limiter
  Object.defineProperties(run, { active: { get: () => active }, waiting: { get: () => queue.length } })
  return run
}

function abortReason(signal?: AbortSignal): Error {
  const r = signal?.reason
  if (r instanceof Error) return r
  const e = new Error('Canceled')
  e.name = 'AbortError'
  return e
}
