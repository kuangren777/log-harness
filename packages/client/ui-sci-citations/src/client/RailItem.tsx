/**
 * The citation-pool rail button. It reads the frame's view from its owner
 * share rather than from `ctx.layout`, so the pressed state and the click are
 * the same fact and cannot drift.
 */
// Type-only: pulls the `rail.item` seat declaration from the shell that owns it.
import type {} from '@deepseek-ai/dsh-client-ui-sci-shell/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PoolGlyph } from './icons.tsx'
import { CITATIONS_VIEW } from './view-id.ts'
import css from './RailItem.module.css'

/** Glyph edge length inside a rail tile, in CSS pixels. */
const GLYPH_SIZE = 19

/** Full props of the citation-pool rail button. */
export type CitationsRailItemProps = PropsRuntime<'rail.item'> & PropsLocale<'sci-citations'>

/**
 * Render the citation-pool button.
 * @param props - the button's composed slot props.
 * @returns the rail tile.
 */
export function CitationsRailItem({ view, showView, t }: CitationsRailItemProps) {
  const active = view === CITATIONS_VIEW
  const label = t('rail.citations')
  return (
    <button
      type="button"
      className={active ? `${css.tile} ${css.tileActive}` : css.tile}
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={() => { showView(CITATIONS_VIEW) }}
    >
      <PoolGlyph size={GLYPH_SIZE} />
    </button>
  )
}
