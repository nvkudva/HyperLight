import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
}

function trapTab(e: React.KeyboardEvent, root: HTMLElement) {
  const items = focusableIn(root)
  if (items.length === 0) return
  const first = items[0]
  const last = items[items.length - 1]
  const isOutside = !root.contains(document.activeElement)
  if (e.shiftKey && (document.activeElement === first || isOutside)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (document.activeElement === last || isOutside)) {
    e.preventDefault()
    first.focus()
  }
}

// Keyboard behavior of a modal dialog: focus moves in (again whenever
// `contentKey` changes), Tab stays inside, Esc dismisses, and the keys never
// reach app-level shortcuts. The caller makes the page behind it inert.
export function useModalDialog(onDismiss: () => void, contentKey: unknown) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    return () => opener?.focus()
  }, [])

  useEffect(() => {
    if (dialogRef.current) focusableIn(dialogRef.current)[0]?.focus()
  }, [contentKey])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') onDismiss()
    else if (e.key === 'Tab' && dialogRef.current) trapTab(e, dialogRef.current)
  }

  return { dialogRef, handleKeyDown }
}
