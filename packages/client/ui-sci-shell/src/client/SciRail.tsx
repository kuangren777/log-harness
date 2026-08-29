/**
 * The leftmost icon rail: the brand mark, the view buttons, and the footer
 * controls. The column owns no view state of its own — it hands the frame's
 * `view`/`showView` pair straight to both seats it declares, so a later view
 * package adds a button by registering into `rail.item` and nothing here
 * changes.
 */
import { SciLogo } from '@deepseek-ai/dsh-client-ui-brand-sci/client'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SciRail.module.css'

/** Brand mark edge length inside the rail's gradient tile, in CSS pixels. */
const LOGO_SIZE = 22

/** Full props of the rail occupant, composed from its shares. */
export type SciRailProps =
  PropsRuntime<'rail'>
  & PropsRenderSlots<'rail.item' | 'rail.footer'>
  & PropsLocale<'sci-shell'>

/**
 * Render the icon rail.
 * @param props - the rail's composed slot props.
 * @returns the full-height column.
 */
export function SciRail({ view, showView, renderSlot, t }: SciRailProps) {
  const owner = { view, showView }
  return (
    <div className={css.root}>
      <div className={css.mark} role="img" aria-label={t('rail.brand')} title={t('rail.brand')}>
        <SciLogo size={LOGO_SIZE} />
      </div>
      <nav className={css.items} aria-label={t('rail.brand')}>{renderSlot('rail.item', owner)}</nav>
      <div className={css.spacer} />
      <div className={css.footer}>{renderSlot('rail.footer', owner)}</div>
    </div>
  )
}
