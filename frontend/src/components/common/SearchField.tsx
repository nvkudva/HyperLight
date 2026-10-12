import React from 'react'

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
  ariaActiveDescendant?: string
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
  ariaActiveDescendant,
}) => (
  <input
    id={id}
    ref={inputRef}
    type="text"
    className={inputClassName}
    placeholder={placeholder}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    onKeyDown={onKeyDown}
    role="combobox"
    aria-expanded={ariaExpanded}
    aria-controls={ariaControls}
    aria-activedescendant={ariaActiveDescendant}
  />
)
