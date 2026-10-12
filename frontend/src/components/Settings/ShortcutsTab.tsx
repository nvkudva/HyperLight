import React, { useEffect, useState } from 'react'
import { updateAppSettings } from '../../api'
import type { AppSettings, HotkeyConfig } from '../../types'
import styles from './SettingsPage.module.css'

const CODE_TO_KEYCODE: Record<string, number> = {
  KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyH: 4, KeyG: 5, KeyZ: 6, KeyX: 7,
  KeyC: 8, KeyV: 9, KeyB: 11, KeyQ: 12, KeyW: 13, KeyE: 14, KeyR: 15,
  KeyY: 16, KeyT: 17, Digit1: 18, Digit2: 19, Digit3: 20, Digit4: 21,
  Digit6: 22, Digit5: 23, Equal: 24, Digit9: 25, Digit7: 26, Minus: 27,
  Digit8: 28, Digit0: 29, BracketRight: 30, KeyO: 31, KeyU: 32,
  BracketLeft: 33, KeyI: 34, KeyP: 35, Enter: 36, KeyL: 37, KeyJ: 38,
  Quote: 39, KeyK: 40, Semicolon: 41, Backslash: 42, Comma: 43, Slash: 44,
  KeyN: 45, KeyM: 46, Period: 47, Tab: 48, Space: 49, Backquote: 50,
  Backspace: 51, Escape: 53, NumpadEnter: 76, F5: 96, F6: 97, F7: 98,
  F3: 99, F8: 100, F9: 101, F11: 103, F13: 105, F16: 106, F14: 107,
  F10: 109, F12: 111, F15: 113, F14_: 107, F4: 118, F2: 120, F1: 122,
  ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126,
}

const MODIFIER_KEYCODES = new Set([54, 55, 56, 57, 58, 59, 60, 61, 62, 63])

const MOD_SYMBOLS: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', cmd: '⌘' }

function displayKey(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Arrow')) return { ArrowLeft: '←', ArrowRight: '→', ArrowDown: '↓', ArrowUp: '↑' }[code] ?? code
  return { Space: 'Space', Enter: 'Return', Escape: 'Esc', Tab: 'Tab', Backspace: 'Delete' }[code] ?? code
}

export function hotkeyLabel(hotkey?: HotkeyConfig): string {
  if (!hotkey || hotkey === 'double_ctrl') return 'Double-press Right Ctrl'
  return hotkey.label
}

export async function syncHotkeyToNative(settings: AppSettings): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_hotkey', {
      enabled: settings.hotkey_enabled ?? true,
      hotkey: settings.hotkey ?? 'double_ctrl',
    })
  } catch {
    // Browser build or native bridge unavailable: settings still persist server-side.
  }
}

export async function openAccessibilitySettings(): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_accessibility_settings')
    return true
  } catch {
    return false
  }
}

interface ShortcutsTabProps {
  settings: AppSettings
  onSaveHotkey: (patch: Partial<AppSettings>, toastMsg?: string) => Promise<void>
  onShowToast: (msg: string, color?: string) => void
}

export const ShortcutsTab: React.FC<ShortcutsTabProps> = ({ settings, onSaveHotkey, onShowToast }) => {
  const [recording, setRecording] = useState(false)
  const enabled = settings.hotkey_enabled ?? true
  const voice = settings.hotkey_voice ?? true

  useEffect(() => {
    if (!recording) return
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        setRecording(false)
        return
      }
      const mods: string[] = []
      if (e.ctrlKey) mods.push('ctrl')
      if (e.altKey) mods.push('alt')
      if (e.shiftKey) mods.push('shift')
      if (e.metaKey) mods.push('cmd')
      const keyCode = CODE_TO_KEYCODE[e.code]
      if (keyCode === undefined) {
        onShowToast(`Can't use '${e.code}' as a global shortcut. Try another key.`, 'amber')
        return
      }
      if (MODIFIER_KEYCODES.has(keyCode)) {
        onShowToast('Pick a non-modifier key with at least one modifier.', 'amber')
        return
      }
      const isFKey = /^F\d{1,2}$/.test(displayKey(e.code)) || e.code.startsWith('F')
      if (mods.length === 0 && !isFKey) {
        onShowToast('Add at least one modifier (⌃ ⌥ ⇧ ⌘), or use a function key.', 'amber')
        return
      }
      const label = [...mods.map((m) => MOD_SYMBOLS[m]), displayKey(e.code)].join(' ')
      setRecording(false)
      await onSaveHotkey({ hotkey: { key_code: keyCode, modifiers: mods, label } }, `Shortcut set to ${label}.`)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onSaveHotkey, onShowToast])

  const handleReset = () => onSaveHotkey({ hotkey: 'double_ctrl' }, 'Shortcut reset to double-press Right Ctrl.')

  const handleAccessibility = async () => {
    const ok = await openAccessibilitySettings()
    if (!ok) onShowToast('Open System Settings → Privacy & Security → Accessibility (desktop app only).', 'blue')
  }

  return (
    <div className={styles.panel}>
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderCol}>
            <h2 className={styles.cardTitle}>Quick search shortcut</h2>
            <p className={styles.cardSubtitle}>
              Opens Hyperlight anywhere on this Mac and starts voice search with the mic on.
            </p>
          </div>
          <label className={styles.switch} title="Toggle global shortcut">
            <input
              type="checkbox"
              checked={enabled}
              onChange={() => void onSaveHotkey({ hotkey_enabled: !enabled })}
            />
            <span className={styles.slider} />
          </label>
        </div>

        <div className={styles.shortcutRow}>
          <span className={styles.shortcutPill}>{recording ? 'Press keys…' : hotkeyLabel(settings.hotkey)}</span>
          {recording ? (
            <button className={styles.button} onClick={() => setRecording(false)}>
              Cancel
            </button>
          ) : (
            <>
              <button className={styles.button} onClick={() => setRecording(true)}>
                Change
              </button>
              <button className={styles.button} onClick={handleReset}>
                Reset
              </button>
            </>
          )}
        </div>
        <p className={styles.promptHint}>Esc cancels recording. Combos need a modifier or function key.</p>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderCol}>
            <h2 className={styles.cardTitle}>Voice on shortcut</h2>
            <p className={styles.cardSubtitle}>Turn the mic on automatically when the shortcut opens search.</p>
          </div>
          <label className={styles.switch} title="Toggle voice on shortcut">
            <input
              type="checkbox"
              checked={voice}
              onChange={() => void onSaveHotkey({ hotkey_voice: !voice })}
            />
            <span className={styles.slider} />
          </label>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderCol}>
            <h2 className={styles.cardTitle}>Accessibility permission</h2>
            <p className={styles.cardSubtitle}>
              The desktop app watches for the shortcut system-wide. If pressing it does nothing,
              allow Hyperlight under Privacy & Security → Accessibility.
            </p>
          </div>
          <button className={styles.button} onClick={() => void handleAccessibility()}>
            Open Settings
          </button>
        </div>
      </div>
    </div>
  )
}

export async function saveHotkeyPatch(
  patch: Partial<AppSettings>,
  onSettings: (s: AppSettings) => void,
  onShowToast: (msg: string, color?: string) => void,
  toastMsg?: string
): Promise<void> {
  try {
    const updated = await updateAppSettings(patch)
    onSettings(updated)
    await syncHotkeyToNative(updated)
    if (toastMsg) onShowToast(toastMsg, 'emerald')
  } catch (err: any) {
    onShowToast(`Failed to save shortcut: ${err.message}`, 'red')
  }
}
