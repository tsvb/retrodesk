import { useEffect, useRef, useState } from 'react'

/** Re-renders on every minute boundary (or every `ms`). */
export function useNow(ms = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const schedule = () => {
      const delay = ms >= 60_000 ? ms - (Date.now() % 60_000) + 20 : ms
      t = setTimeout(() => {
        setNow(new Date())
        schedule()
      }, delay)
    }
    schedule()
    return () => clearTimeout(t)
  }, [ms])
  return now
}

export interface BatteryInfo {
  percent: number
  charging: boolean
}

/** Battery from the Battery Status API, if this machine has one. */
export function useBattery(): BatteryInfo | null {
  const [info, setInfo] = useState<BatteryInfo | null>(null)
  useEffect(() => {
    let mgr: BatteryManager | null = null
    let canceled = false
    const update = () => {
      if (!mgr) return
      // Desktops report a permanently charging 100% battery: treat as "no battery".
      if (mgr.charging && mgr.level === 1 && !navigator.userAgent.includes('Mobile')) {
        setInfo(null)
        return
      }
      setInfo({ percent: Math.round(mgr.level * 100), charging: mgr.charging })
    }
    navigator
      .getBattery?.()
      .then((m) => {
        if (canceled) return
        mgr = m
        update()
        m.addEventListener('levelchange', update)
        m.addEventListener('chargingchange', update)
      })
      .catch(() => undefined)
    return () => {
      canceled = true
      mgr?.removeEventListener('levelchange', update)
      mgr?.removeEventListener('chargingchange', update)
    }
  }, [])
  return info
}

/**
 * Poll an async function at an interval while mounted. While `skip()` returns true the call (and the re-render it
 * causes) is left out, but the timer keeps ticking so polling picks up again by itself.
 */
export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = [], skip?: () => boolean): T | null {
  const [value, setValue] = useState<T | null>(null)
  const skipRef = useRef(skip)
  skipRef.current = skip
  useEffect(() => {
    let alive = true
    let t: ReturnType<typeof setTimeout>
    const run = async () => {
      try {
        if (!skipRef.current?.()) {
          const v = await fn()
          if (alive) setValue(v)
        }
      } catch {
        /* keep last value */
      }
      if (alive) t = setTimeout(run, ms)
    }
    void run()
    return () => {
      alive = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps])
  return value
}
