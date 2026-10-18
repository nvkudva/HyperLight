import React from 'react'
import type { useAudioSearch } from '../../hooks/useAudioSearch'
import { ClearIcon, HistoryIcon, SearchIcon, SettingsIcon, XIcon } from '../common/Icons'
import { SearchBox } from '../common/SearchBox'
import * as native from '../../native'
import styles from './TopBar.module.css'

export type TopTab = 'search' | 'settings'

interface TopBarProps {
  query: string
  onQueryChange: (q: string) => void
  onInputKeyDown: (e: React.KeyboardEvent) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  activeTab: TopTab
  onSelectTab: (tab: TopTab) => void
  historyOpen: boolean
  onToggleHistory: () => void
  accessory?: React.ReactNode
  onDragStart: (e: React.MouseEvent) => void
  onActivateSearch: () => void
  voice: ReturnType<typeof useAudioSearch>
}

export const TopBar: React.FC<TopBarProps> = ({
  query,
  onQueryChange,
  onInputKeyDown,
  inputRef,
  activeTab,
  onSelectTab,
  historyOpen,
  onToggleHistory,
  accessory,
  onDragStart,
  onActivateSearch,
  voice,
}) => {
  const audioStarting = voice.starting || voice.listening
  const audioActive = audioStarting || voice.searching

  const tab = (id: TopTab, label: string, title: string, Icon: React.FC<{ className?: string }>) => (
    <button
      className={`${styles.iconButton} ${activeTab === id ? styles.tabActive : ''}`}
      onClick={() => onSelectTab(id)}
      aria-label={label}
      title={title}
      aria-current={activeTab === id ? 'page' : undefined}
    >
      <Icon className={styles.tabIcon} />
    </button>
  )

  return (
    <header
      className={styles.header}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDragStart(e)
        else if (e.target === inputRef.current) onActivateSearch()
      }}
    >
      <SearchBox
        id="unified-search-input"
        inputRef={inputRef}
        inputClassName={styles.searchInput}
        placeholder={audioStarting ? 'Listening…' : 'Search files, photos, mail and apps'}
        value={query}
        onChange={onQueryChange}
        onKeyDown={onInputKeyDown}
        expanded={query.trim().length > 0}
        controls="search-results"
        leading={
          <>
            <SearchIcon className={styles.searchIcon} />
            {audioActive && (
              <canvas
                ref={voice.waveCanvas}
                width={144}
                height={48}
                className={styles.waveCanvas}
                role="status"
                aria-label={voice.searching ? 'Searching audio…' : 'Listening…'}
              />
            )}
          </>
        }
        trailing={
          <>
            {query && (
              <button
                className={styles.iconButton}
                onClick={() => {
                  onQueryChange('')
                  inputRef.current?.focus()
                }}
                aria-label="Clear search"
                title="Clear search"
              >
                <ClearIcon className={styles.tabIcon} />
              </button>
            )}
            {accessory}
          </>
        }
        voice={{
          supported: voice.supported,
          listening: audioStarting,
          disabled: !voice.supported,
          toggle: () => {
            onActivateSearch()
            voice.toggle()
          },
          micLabel: audioStarting ? 'Stop voice search' : 'Voice search',
          micTitle:
            voice.error ??
            (voice.supported
              ? voice.searching
                ? 'Searching audio…'
                : audioStarting
                  ? 'Listening… click to stop'
                  : 'Search by voice'
              : 'Voice search not supported here'),
          buttonClassName: styles.iconButton,
          activeClassName: styles.micActive,
          iconClassName: styles.tabIcon,
        }}
        renderMic={(mic) => (
          <div className={styles.micWrap}>
            {mic}
            {voice.error && (
              <p role="alert" className={styles.micError}>
                {voice.error}
              </p>
            )}
          </div>
        )}
      />
      <nav className={styles.tabs} aria-label="Views">
        <button
          className={`${styles.iconButton} ${historyOpen ? styles.tabActive : ''}`}
          onClick={onToggleHistory}
          aria-label="History"
          title="Search history"
          aria-pressed={historyOpen}
        >
          <HistoryIcon className={styles.tabIcon} />
        </button>
        {tab('settings', 'Settings', 'Settings (⌘,)', SettingsIcon)}
        {'__TAURI_INTERNALS__' in window && (
          <button className={styles.iconButton} onClick={() => void native.hideWindow()} aria-label="Close" title="Close">
            <XIcon className={styles.tabIcon} />
          </button>
        )}
      </nav>
    </header>
  )
}
