import React from 'react'
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
  leading?: React.ReactNode
  trailing?: React.ReactNode
  renderMic?: (mic: React.ReactNode) => React.ReactNode
  voice?: SearchBoxVoice
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
  leading,
  trailing,
  renderMic,
  voice,
}) => {
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
      {leading}
      <SearchField
        id={id}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        inputRef={inputRef}
        inputClassName={inputClassName}
        ariaExpanded={expanded}
        ariaControls={controls}
      />
      {trailing}
      {renderMic ? renderMic(mic) : mic}
    </>
  )
}
