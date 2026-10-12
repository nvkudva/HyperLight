import React, { useState } from 'react'
import { useVoiceInput } from '../../hooks/useVoiceInput'
import type { SearchResult } from '../../types'
import { SearchBox } from '../common/SearchBox'
import styles from './ChatWorkspace.module.css'

interface ChatInputProps {
  isLoading: boolean
  onSendMessage: (text: string) => void
  onOpenResult: (item: SearchResult) => void
  onContextMenu: (e: React.MouseEvent, path: string, filename: string) => void
}

export const ChatInput: React.FC<ChatInputProps> = ({ isLoading, onSendMessage, onOpenResult, onContextMenu }) => {
  const [inputText, setInputText] = useState('')
  const voice = useVoiceInput((text) => setInputText(text))

  return (
    <div className={styles.inputBarWrapper}>
      {voice.error && (
        <p role="alert" className={styles.voiceError}>
          {voice.error}
        </p>
      )}
      <SearchBox
        value={inputText}
        onChange={setInputText}
        placeholder="Ask anything, find photos, or search files..."
        inputClassName={styles.textInput}
        voice={{
          supported: voice.supported,
          listening: voice.listening,
          toggle: voice.toggle,
          micLabel: voice.listening ? 'Stop voice input' : 'Voice input',
          micTitle: voice.error ?? (voice.supported ? (voice.listening ? 'Listening… click to stop' : 'Speak to search') : 'Voice input not supported here'),
          buttonClassName: styles.micButton,
          activeClassName: styles.micActive,
          iconClassName: styles.micIcon,
        }}
        suggestions={{ limit: 8, onOpenResult, onContextMenu }}
        submit={{
          onSubmit: (text) => {
            voice.stop()
            onSendMessage(text)
            setInputText('')
          },
          busy: isLoading,
          sendClassName: styles.sendButton,
        }}
        formClassName={styles.inputBar}
      />
    </div>
  )
}
