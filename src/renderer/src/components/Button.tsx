import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useFocusable } from '../input/hooks'
import type { FocusNodeOptions } from '../input/focus'

export interface ButtonProps extends Omit<FocusNodeOptions, 'onActivate'> {
  children?: ReactNode
  icon?: LucideIcon
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  onPress?: () => void
  busy?: boolean
  className?: string
  title?: string
}

/** A focusable button. Uses the focus system for activation; never takes DOM focus. */
export function Button({ children, icon: Icon, variant = 'secondary', size = 'md', onPress, busy, className = '', title, disabled, ...focusOpts }: ButtonProps) {
  const { props } = useFocusable<HTMLButtonElement>({
    ...focusOpts,
    disabled,
    label: focusOpts.label ?? (typeof children === 'string' ? children : 'Select'),
    onActivate: disabled || busy ? undefined : onPress
  })
  return (
    <button
      type="button"
      tabIndex={-1}
      title={title}
      className={`btn btn--${variant} btn--${size} ${busy ? 'is-busy' : ''} ${disabled ? 'is-disabled' : ''} ${!children ? 'btn--icon' : ''} ${className}`}
      aria-disabled={disabled || undefined}
      {...props}
    >
      {busy ? <span className="spinner spinner--inline" /> : Icon ? <Icon className="btn__icon" size="1.15em" strokeWidth={2.2} /> : null}
      {children && <span className="btn__label">{children}</span>}
    </button>
  )
}
