import React from 'react'

// The backend rejects longer queries with a 422.
const MAX_QUERY_LENGTH = 500

interface SearchFieldProps {
  id?: string
  value: string
  onChange: (text: string) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  placeholder?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
  inputClassName?: string
  ariaExpanded?: boolean
  ariaControls?: string
}

export const SearchField: React.FC<SearchFieldProps> = ({
  id,
  value,
  onChange,
  onKeyDown,
  placeholder,
  inputRef,
  inputClassName,
  ariaExpanded,
  ariaControls,
}) => (
  <input
    id={id}
    ref={inputRef}
    type="text"
    maxLength={MAX_QUERY_LENGTH}
    className={inputClassName}
    placeholder={placeholder}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    onKeyDown={onKeyDown}
    role="combobox"
    aria-expanded={ariaExpanded}
    aria-controls={ariaControls}
  />
)
