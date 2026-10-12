import React, { useState } from 'react'
import styles from './SearchScreen.module.css'

export const VISUAL_PREVIEW = /\.(pdf|docx?|pptx?|xlsx?|key|pages|numbers|rtf|heic|png|jpe?g|gif|webp|tiff?)$/i

interface ResultThumbnailProps {
  path: string
  fallback: React.ReactNode
}

export const ResultThumbnail: React.FC<ResultThumbnailProps> = ({ path, fallback }) => {
  const [failed, setFailed] = useState(false)
  if (!path || !VISUAL_PREVIEW.test(path) || failed) return <>{fallback}</>
  return (
    <img
      className={styles.thumb}
      src={`/api/preview?path=${encodeURIComponent(path)}&size=96`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}
