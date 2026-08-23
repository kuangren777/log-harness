// Toggle: token-styled boolean switch atom. A single button carries both the
// optional label and the track/knob so activation, focus, and hit area stay
// unified; no framework imports, all behavior via props.

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import css from './Toggle.module.css'

/** Props accepted by {@link Toggle}. */
export type ToggleProps = {
  /** Current on/off state. */
  checked: boolean
  /** Invoked with the inverted state on activation (click, Space, or Enter). */
  onChange: (next: boolean) => void
  disabled?: boolean
  /** Optional text rendered inside the button, left of the track. */
  label?: ReactNode
  id?: string
  className?: string | undefined
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'>

/**
 * Render a boolean switch as a single `role="switch"` button.
 * @param props.checked - current on/off state.
 * @param props.onChange - receives the inverted state on activation.
 * @param props.label - optional text left of the track; clicking it also toggles.
 * @returns the switch element; native button attributes pass through.
 */
export function Toggle({ checked, onChange, disabled, label, id, className, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={clsx(css.toggle, className)}
      onClick={() => { onChange(!checked) }}
      {...rest}
    >
      {label != null && <span className={css.label}>{label}</span>}
      <span className={css.track} data-checked={checked || undefined} aria-hidden="true">
        <span className={css.knob} />
      </span>
    </button>
  )
}
