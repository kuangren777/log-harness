/**
 * One labelled switch row: the permission and enable controls of the
 * configuration page.
 *
 * A real `role="switch"` button rather than a styled div — the control is
 * reachable by keyboard, states whether it is on, and carries the same label
 * a sighted reader sees.
 */
import css from './Switch.module.css'

/** Owner-controlled switch props. */
export interface SwitchProps {
  /** Whether the switch is on. */
  checked: boolean
  /** The control's name, rendered and used as its accessible name. */
  label: string
  /** What flipping it actually does, in the reader's language. */
  description: string
  /** Flip the switch; the owner writes the new value through the host. */
  onChange: (next: boolean) => void
}

/**
 * Render one switch row.
 * @param props - the row's owner-controlled props.
 * @returns the labelled row with its switch.
 */
export function Switch({ checked, label, description, onChange }: SwitchProps) {
  return (
    <div className={css.row}>
      <div className={css.text}>
        <div className={css.label}>{label}</div>
        <div className={css.description}>{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={checked ? `${css.track} ${css.trackOn}` : css.track}
        onClick={() => { onChange(!checked) }}
      >
        <span className={css.knob} />
      </button>
    </div>
  )
}
