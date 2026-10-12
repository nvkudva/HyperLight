import { useCallback, useEffect, useState } from 'react'
import { fetchIndexStatus } from '../api'
import type { IndexJobStatus } from '../types'

/** Polls /api/indexing-status (1s while running, 3s idle) and reports the latest state. */
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
    let timer: number
    let wasRunning = false
    let failures = 0
    const poll = async () => {
      try {
        const status = await fetchIndexStatus()
        if (failures > 0) onSettledChange()
        failures = 0
        setIndexStatus(status)
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
      timer = window.setTimeout(poll, wasRunning ? 1000 : 3000)
    }
    poll()
    return () => clearTimeout(timer)
  }, [onSettledChange])

  return { status: indexStatus, refresh }
}
