import React, { useState } from 'react'
import { useLiveSearch } from '../../hooks/useLiveSearch'
import type { SearchResult } from '../../types'
import { KIND_LABELS, kindOf, renderTile } from '../Chat/kinds'
import chatStyles from '../Chat/ChatWorkspace.module.css'
import { MicButton } from './MicButton'
import { SearchField } from './SearchField'

export interface SearchBoxVoice {
  supported: boolean
  listening: boolean
  disabled?: boolean
  toggle: () => void
  micLabel: string
  micTitle?: string
  buttonClassName?: string
  activeClassName?: string
  iconClassName?: string
}

export interface SearchBoxSuggestions {
  limit?: number
  onOpenResult: (item: SearchResult) => void
  onContextMenu: (e: React.MouseEvent, path: string, filename: string) => void
}

export interface SearchBoxSubmit {
  onSubmit: (text: string) => void
  busy?: boolean
  sendTitle?: string
  sendClassName?: string
}

interface SearchBoxProps {
  id?: string
  value: string
  onChange: (text: string) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  placeholder?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
  inputClassName?: string
  expanded?: boolean
  controls?: string
  listId?: string
  listLabel?: string
  leading?: React.ReactNode
  trailing?: React.ReactNode
  renderMic?: (mic: React.ReactNode) => React.ReactNode
  voice?: SearchBoxVoice
  suggestions?: SearchBoxSuggestions
  submit?: SearchBoxSubmit
  formClassName?: string
}

export const SearchBox: React.FC<SearchBoxProps> = ({
  id,
  value,
  onChange,
  onKeyDown,
  placeholder,
  inputRef,
  inputClassName,
  expanded,
  controls,
  listId = 'chat-suggestions',
  listLabel = 'Matching files',
  leading,
  trailing,
  renderMic,
  voice,
  suggestions,
  submit,
  formClassName,
}) => {
  const [showSuggestions, setShowSuggestions] = useState(true)
  const [selected, setSelected] = useState(-1)
  const live = useLiveSearch(suggestions ? value : '', suggestions?.limit ?? 8)
  const list = suggestions && showSuggestions ? live.flatItems.slice(0, 7) : []

  const handleChange = (text: string) => {
    setShowSuggestions(true)
    setSelected(-1)
    onChange(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (list.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = list.length
        setSelected((cur) => (e.key === 'ArrowDown' ? (cur + 1 >= n ? -1 : cur + 1) : cur - 1 < -1 ? n - 1 : cur - 1))
        return
      }
      if (e.key === 'Enter' && selected >= 0) {
        e.preventDefault()
        suggestions?.onOpenResult(list[selected])
        return
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false)
        setSelected(-1)
        return
      }
    }
    onKeyDown?.(e)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!submit || !value.trim() || submit.busy) return
    submit.onSubmit(value.trim())
  }

  const mic = voice ? (
    <MicButton
      supported={voice.supported}
      listening={voice.listening}
      disabled={voice.disabled}
      onToggle={voice.toggle}
      label={voice.micLabel}
      title={voice.micTitle}
      buttonClassName={voice.buttonClassName}
      activeClassName={voice.activeClassName}
      iconClassName={voice.iconClassName}
    />
  ) : null

  return (
    <>
      {list.length > 0 && (
        <div id={listId} role="listbox" aria-label={listLabel} className={chatStyles.suggestions}>
          <div className={chatStyles.suggestionsHeader}>Top matches · ↑↓ to pick, ↵ opens, Esc hides</div>
          {list.map((item, idx) => {
            const kind = kindOf(item)
            const showHeader = idx === 0 || kindOf(list[idx - 1]) !== kind
            return (
              <React.Fragment key={item.path || idx}>
                {showHeader && <div className={chatStyles.suggestionGroup}>{KIND_LABELS[kind]}</div>}
                <div
                  id={`chat-suggestion-${idx}`}
                  role="option"
                  aria-selected={idx === selected}
                  className={`${chatStyles.suggestion} ${idx === selected ? chatStyles.suggestionSelected : ''}`}
                  onMouseEnter={() => setSelected(idx)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => suggestions?.onOpenResult(item)}
                  onContextMenu={(e) => suggestions?.onContextMenu(e, item.path, item.filename)}
                >
                  {kind === 'photo' ? (
                    <img
                      src={`/api/thumbnail?path=${encodeURIComponent(item.path)}`}
                      alt=""
                      className={chatStyles.suggestionThumb}
                      loading="lazy"
                    />
                  ) : (
                    renderTile(kind)
                  )}
                  <span className={chatStyles.suggestionTitle}>{item.filename}</span>
                  <span className={chatStyles.suggestionPath}>{item.excerpt || item.path}</span>
                </div>
              </React.Fragment>
            )
          })}
        </div>
      )}
      {submit ? (
        <form className={formClassName} onSubmit={handleSubmit}>
          {leading}
          <SearchField
            id={id}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            inputRef={inputRef}
            inputClassName={inputClassName}
            ariaExpanded={expanded ?? list.length > 0}
            ariaControls={controls ?? listId}
            ariaActiveDescendant={selected >= 0 ? `chat-suggestion-${selected}` : undefined}
          />
          {trailing}
          {renderMic ? renderMic(mic) : mic}
          <button type="submit" className={submit.sendClassName} disabled={!value.trim() || submit.busy} title={submit.sendTitle}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
            </svg>
          </button>
        </form>
      ) : (
        <>
          {leading}
          <SearchField
            id={id}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            inputRef={inputRef}
            inputClassName={inputClassName}
            ariaExpanded={expanded ?? list.length > 0}
            ariaControls={controls}
            ariaActiveDescendant={selected >= 0 ? `chat-suggestion-${selected}` : undefined}
          />
          {trailing}
          {renderMic ? renderMic(mic) : mic}
        </>
      )}
    </>
  )
}
