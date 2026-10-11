import React, { useEffect } from 'react'
import { launchTarget, revealTarget } from '../../api'
import type { ContextMenuState } from '../../types'
import { DocumentIcon, FolderIcon } from '../common/Icons'
import styles from './ContextMenu.module.css'

interface ContextMenuProps {
  state: ContextMenuState
  onClose: () => void
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ state, onClose }) => {
  useEffect(() => {
    const handleGlobalClick = () => {
      if (state.visible) onClose()
    }
    window.addEventListener('click', handleGlobalClick)
    return () => window.removeEventListener('click', handleGlobalClick)
  }, [state.visible, onClose])

  if (!state.visible) return null

  const handleReveal = async () => {
    await revealTarget(state.path)
    onClose()
  }

  const handleOpen = async () => {
    await launchTarget(state.path)
    onClose()
  }

  const handleCopyPath = () => {
    navigator.clipboard.writeText(state.path)
    onClose()
  }

  return (
    <div
      className={styles.menu}
      style={{
        left: `${Math.min(state.x, window.innerWidth - 220)}px`,
        top: `${Math.min(state.y, window.innerHeight - 150)}px`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.title}>{state.filename}</div>
      <div className={styles.divider} />
      <button className={styles.item} onClick={handleReveal}>
        <div className={styles.itemLeft}>
          <FolderIcon className="w-3.5 h-3.5 opacity-80" />
          <span>Reveal in Finder</span>
        </div>
        <span className={styles.shortcut}>⌘R</span>
      </button>
      <button className={styles.item} onClick={handleOpen}>
        <div className={styles.itemLeft}>
          <DocumentIcon className="w-3.5 h-3.5 opacity-80" />
          <span>Open File</span>
        </div>
        <span className={styles.shortcut}>↵</span>
      </button>
      <button className={styles.item} onClick={handleCopyPath}>
        <div className={styles.itemLeft}>
          <svg className="w-3.5 h-3.5 opacity-80" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span>Copy Path</span>
        </div>
        <span className={styles.shortcut}>⌘C</span>
      </button>
    </div>
  )
}
