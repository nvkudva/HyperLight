import { useCallback, useEffect, useState } from 'react'
import * as api from '../api'
import type { DriveLocation } from '../types'

export const DRIVE_DOWNLOAD_URL = 'https://www.google.com/drive/download/'

export function useDriveLocations() {
  const [locations, setLocations] = useState<DriveLocation[] | null>(null)

  const reload = useCallback(async () => {
    try {
      const res = await api.fetchDriveLocations()
      setLocations(res.locations)
      return res.locations
    } catch {
      setLocations([])
      return []
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { locations, reload }
}
