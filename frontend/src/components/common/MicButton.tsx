import React from 'react'
import { MicIcon } from './Icons'

interface MicButtonProps {
  supported: boolean
  listening: boolean
  disabled?: boolean
  onToggle: () => void
  label: string
  title?: string
  buttonClassName?: string
  activeClassName?: string
  iconClassName?: string
}

export const MicButton: React.FC<MicButtonProps> = ({
  supported,
  listening,
  disabled,
  onToggle,
  label,
  title,
  buttonClassName,
  activeClassName,
  iconClassName,
}) => (
  <button
    type="button"
    className={`${buttonClassName ?? ''} ${listening ? (activeClassName ?? '') : ''}`}
    onClick={onToggle}
    disabled={disabled ?? !supported}
    aria-label={label}
    title={title}
  >
    <MicIcon className={iconClassName} />
  </button>
)
