import React from 'react'
import type { useAudioSearch } from '../../hooks/useAudioSearch'
import { HistoryIcon, SearchIcon, SettingsIcon, XIcon } from '../common/Icons'
import { SearchBox } from '../common/SearchBox'
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
  voice,
}) => {
  const audioActive = voice.listening || voice.searching

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
      onMouseDown={(e) => e.target === e.currentTarget && onDragStart(e)}
    >
      <SearchBox
        id="unified-search-input"
        inputRef={inputRef}
        inputClassName={styles.searchInput}
        placeholder={voice.listening ? 'Listening…' : 'Search files, photos, mail and apps'}
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
                <XIcon className={styles.tabIcon} />
              </button>
            )}
            {accessory}
          </>
        }
        voice={{
          supported: voice.supported,
          listening: voice.listening,
          disabled: !voice.supported || voice.searching,
          toggle: voice.toggle,
          micLabel: voice.listening ? 'Stop voice search' : 'Voice search',
          micTitle:
            voice.error ??
            (voice.supported
              ? voice.searching
                ? 'Searching audio…'
                : voice.listening
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
      </nav>
    </header>
  )
}
