import { useCallback, useEffect, useState } from 'react'
import { fetchIndexStatus } from '../api'
import type { IndexJobStatus } from '../types'

/** Polls /api/indexing-status (100ms while running to match the backend's progress interval, 3s idle, paused while hidden). */
export function useIndexPolling(onSettledChange: () => void): {
  status: IndexJobStatus | null
  refresh: () => Promise<void>
} {
  const [indexStatus, setIndexStatus] = useState<IndexJobStatus | null>(null)

  const refresh = useCallback(async () => {
    try {
      setIndexStatus(await fetchIndexStatus())
    } catch {
      // Keep the last known state on transient failures.
    }
  }, [])

  useEffect(() => {
    let timer: number | undefined
    let cancelled = false
    let wasRunning = false
    let failures = 0
    let inFlight = false
    const poll = async () => {
      window.clearTimeout(timer)
      timer = undefined
      if (inFlight) return
      inFlight = true
      try {
        const status = await fetchIndexStatus()
        if (failures > 0) onSettledChange()
        failures = 0
        // Idle polls usually return identical status; skip the app-wide re-render.
        setIndexStatus((prev) => (prev && JSON.stringify(prev) === JSON.stringify(status) ? prev : status))
        if (wasRunning && !status.is_running) onSettledChange()
        wasRunning = status.is_running
      } catch {
        failures += 1
        if (failures >= 3) {
          setIndexStatus((prev) =>
            prev && prev.is_running
              ? { ...prev, is_running: false, state: 'idle', status: 'Backend unreachable' }
              : prev
          )
          wasRunning = false
        }
      }
      inFlight = false
      if (cancelled || (document.hidden && !wasRunning)) return
      timer = window.setTimeout(poll, wasRunning ? 100 : 3000)
    }
    const onVisibility = () => {
      if (!document.hidden && timer === undefined) void poll()
    }
    document.addEventListener('visibilitychange', onVisibility)
    void poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [onSettledChange])

  return { status: indexStatus, refresh }
}
