import React from 'react'
import { revealTarget } from '../../api'
import styles from './PhotoLightbox.module.css'

interface PhotoLightboxProps {
  photo: { path: string; filename: string } | null
  onClose: () => void
}

export const PhotoLightbox: React.FC<PhotoLightboxProps> = ({ photo, onClose }) => {
  if (!photo) return null

  const handleCopyPath = () => {
    navigator.clipboard.writeText(photo.path)
  }

  const handleReveal = () => {
    revealTarget(photo.path)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>
          &times;
        </button>
        <img
          src={`/api/thumbnail?path=${encodeURIComponent(photo.path)}`}
          alt={photo.filename}
          className={styles.image}
        />
        <div className={styles.footer}>
          <span className={styles.caption}>{photo.filename}</span>
          <button className={styles.actionBtn} onClick={handleCopyPath}>
            Copy Path
          </button>
          <button className={styles.actionBtn} onClick={handleReveal}>
            Reveal in Finder
          </button>
        </div>
      </div>
    </div>
  )
}
