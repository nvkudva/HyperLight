// Bridge to the Tauri shell: window sizing and dragging, the global hotkey.
// Every call is a no-op in the browser build.
import type React from 'react'
import { useEffect, useRef } from 'react'
import { fetchAppSettings } from './api'
import type { AppSettings } from './types'

const WINDOW_SIZE: [number, number] = [1140, 780]

export async function resizeWindow() {
  try {
    const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window')
    const [w, h] = WINDOW_SIZE
    await getCurrentWindow().setSize(new LogicalSize(w, h))
  } catch {
    // Not running inside Tauri
  }
}

export async function startWindowDrag(e: React.MouseEvent) {
  if (e.button !== 0) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().startDragging()
  } catch {
    // Not running inside Tauri
  }
}

// Hides instead of closing so the global hotkey can bring the window back.
export async function hideWindow() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().hide()
  } catch {
    // Not running inside Tauri
  }
}

export async function syncHotkey(settings: AppSettings): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_hotkey', {
      enabled: settings.hotkey_enabled,
      voice: settings.hotkey_voice,
      hotkey: settings.hotkey,
    })
  } catch {
    // Browser build or native bridge unavailable: settings still persist server-side.
  }
}

// Asks macOS for Input Monitoring (needed by the global hotkey). Resolves
// true when granted, false when the user must finish in System Settings, and
// null outside the desktop app.
export async function requestKeyboardAccess(): Promise<boolean | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<boolean>('request_keyboard_access')
  } catch {
    return null
  }
}

// Pushes saved hotkey settings to the shell once, then calls onHotkey with
// the voice flag the shell resolved from those settings.
export function useHotkey(onHotkey: (voice: boolean) => void) {
  const handlerRef = useRef(onHotkey)
  useEffect(() => {
    handlerRef.current = onHotkey
  })

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    ;(async () => {
      try {
        const [{ listen }, settings] = await Promise.all([
          import('@tauri-apps/api/event'),
          fetchAppSettings().catch(() => null),
        ])
        if (cancelled) return
        if (settings) await syncHotkey(settings)
        const off = await listen<{ voice: boolean }>('hyperlight-hotkey', (event) => {
          handlerRef.current(event.payload.voice)
        })
        if (cancelled) off()
        else unlisten = off
      } catch {
        // Browser build: no native hotkey bridge.
      }
    })()
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])
}
