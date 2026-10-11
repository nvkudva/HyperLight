import { useCallback, useState } from 'react'
import * as api from '../api'
import type { GoogleStatus } from '../types'

const POLL_MS = 1500
const MAX_POLLS = 120

// Opens Google consent in the system browser and resolves once the callback has stored tokens.
export function useGoogleSignIn() {
  const [isSigningIn, setIsSigningIn] = useState(false)

  const signIn = useCallback(async (): Promise<GoogleStatus> => {
    setIsSigningIn(true)
    try {
      const res = await api.fetchGoogleAuthUrl()
      if (!res.url) throw new Error(res.error || 'Could not start Google sign-in.')
      await api.launchTarget(res.url)
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        const status = await api.fetchGoogleStatus()
        if (status.connected) return status
      }
      throw new Error('Sign-in timed out. Please try again.')
    } finally {
      setIsSigningIn(false)
    }
  }, [])

  return { signIn, isSigningIn }
}
