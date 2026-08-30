/**
 * The knowledge-library rail button. It reads the frame's view from its owner
 * share rather than from `ctx.layout`, so the pressed state and the click are
 * the same fact and cannot drift.
 */
// Type-only: pulls the `rail.item` seat declaration from the shell that owns it.
import type {} from '@deepseek-ai/dsh-client-ui-sci-shell/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { LibraryGlyph } from './icons.tsx'
import { LIBRARY_VIEW } from './view-id.ts'
import css from './RailItem.module.css'

/** Glyph edge length inside a rail tile, in CSS pixels. */
const GLYPH_SIZE = 19

/** Full props of the knowledge-library rail button. */
export type LibraryRailItemProps = PropsRuntime<'rail.item'> & PropsLocale<'sci-library'>

/**
 * Render the library button.
 * @param props - the button's composed slot props.
 * @returns the rail tile.
 */
export function LibraryRailItem({ view, showView, t }: LibraryRailItemProps) {
  const active = view === LIBRARY_VIEW
  const label = t('rail.library')
  return (
    <button
      type="button"
      className={active ? `${css.tile} ${css.tileActive}` : css.tile}
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={() => { showView(LIBRARY_VIEW) }}
    >
      <LibraryGlyph size={GLYPH_SIZE} />
    </button>
  )
}
