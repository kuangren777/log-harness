/**
 * The aurora backdrop: two blurred colour fields drifting behind the whole
 * frame. Purely decorative — it is `aria-hidden`, never takes pointer events,
 * and carries `data-sci-motion` so ui-brand-sci's reduced-motion rule can
 * disarm its animation without touching anything else on the page.
 */
import css from './Aurora.module.css'

/**
 * Render the aurora layer.
 * @returns the two-field backdrop.
 */
export function Aurora() {
  return (
    <div className={css.root} data-sci-motion aria-hidden="true">
      <div className={css.fieldA} />
      <div className={css.fieldB} />
    </div>
  )
}
