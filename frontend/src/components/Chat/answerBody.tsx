import React from 'react'
import { looksLikeHtml, markdownToHtml } from './markdown'
import { sanitizeHtml } from './sanitize'
import styles from './ChatWorkspace.module.css'

export const AnswerBody: React.FC<{ text: string }> = ({ text }) => {
  const html = React.useMemo(() => {
    const raw = looksLikeHtml(text) ? sanitizeHtml(text) : markdownToHtml(text)
    return { __html: raw }
  }, [text])
  return <div className={styles.richText} dangerouslySetInnerHTML={html} />
}
