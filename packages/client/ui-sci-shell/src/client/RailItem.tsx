/**
 * The research-flow rail button: the one view this release ships. It reads
 * the frame's view from its owner share rather than from `ctx.layout`, so the
 * pressed state and the click are the same fact and cannot drift.
 */
import { CONVERSATION_VIEW } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { FlowGlyph } from './icons.tsx'
import css from './RailItem.module.css'

/** Glyph edge length inside a rail tile, in CSS pixels. */
const GLYPH_SIZE = 19

/** Full props of the research-flow rail button. */
export type ConversationRailItemProps = PropsRuntime<'rail.item'> & PropsLocale<'sci-shell'>

/**
 * Render the research-flow button.
 * @param props - the button's composed slot props.
 * @returns the rail tile.
 */
export function ConversationRailItem({ view, showView, t }: ConversationRailItemProps) {
  const active = view === CONVERSATION_VIEW
  const label = t('rail.conversation')
  return (
    <button
      type="button"
      className={active ? `${css.tile} ${css.tileActive}` : css.tile}
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={() => { showView(CONVERSATION_VIEW) }}
    >
      <FlowGlyph size={GLYPH_SIZE} />
    </button>
  )
}
