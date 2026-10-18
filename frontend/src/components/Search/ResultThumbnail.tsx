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
  const isApp = /\.app$/i.test(path)
  if (!isApp && !VISUAL_PREVIEW.test(path)) return <>{fallback}</>
  const src = isApp
    ? `/api/app-icon?path=${encodeURIComponent(path)}&size=${size}`
    : `/api/preview?path=${encodeURIComponent(path)}&size=${size}`
  return (
    <img
      className={className ?? styles.thumb}
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}
