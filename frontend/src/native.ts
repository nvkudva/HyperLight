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

// Whether Input Monitoring is already granted. null outside the desktop app.
export async function keyboardAccessGranted(): Promise<boolean | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<boolean>('keyboard_access_granted')
  } catch {
    return null
  }
}

// Whether microphone access is already granted. null outside the desktop app.
export async function microphoneAccessGranted(): Promise<boolean | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<boolean>('microphone_access_granted')
  } catch {
    return null
  }
}

// Shows the macOS microphone prompt, or opens System Settings if it was denied.
export async function requestMicrophoneAccess(): Promise<boolean | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<boolean>('request_microphone_access')
  } catch {
    return null
  }
}

// Calls onOpen when the menu bar icon asks for the history or settings view.
export function useOpenViewRequest(onOpen: (view: 'history' | 'settings') => void) {
  const handlerRef = useRef(onOpen)
  useEffect(() => {
    handlerRef.current = onOpen
  })

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<'history' | 'settings'>('hyperlight-open-view', (event) => handlerRef.current(event.payload))
      )
      .then((off) => {
        if (cancelled) off()
        else unlisten = off
      })
      .catch(() => {
        // Browser build: no menu bar icon.
      })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])
}

export async function startPermissionDrag(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('start_permission_drag')
  } catch {
    // Not running from an app bundle, or not in Tauri.
  }
}

export async function closePermissionHelper(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('close_permission_helper')
  } catch {
    // Not running inside Tauri
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
