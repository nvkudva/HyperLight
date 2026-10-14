import React, { useState } from 'react'
import styles from './SearchScreen.module.css'

export const VISUAL_PREVIEW = /\.(pdf|docx?|pptx?|xlsx?|key|pages|numbers|rtf|heic|png|jpe?g|gif|webp|tiff?)$/i

interface ResultThumbnailProps {
  path: string
  fallback: React.ReactNode
  size?: number
  className?: string
}

export const ResultThumbnail: React.FC<ResultThumbnailProps> = ({ path, fallback, size = 96, className }) => {
  const [failed, setFailed] = useState(false)
  if (!path || failed) return <>{fallback}</>
  const previewable = /\.app$/i.test(path) || VISUAL_PREVIEW.test(path)
  if (!previewable) return <>{fallback}</>
  return (
    <img
      className={className ?? styles.thumb}
      src={`/api/preview?path=${encodeURIComponent(path)}&size=${size}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}
