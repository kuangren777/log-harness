/**
 * The agent-roster rail button. It reads the frame's view from its owner
 * share rather than from `ctx.layout`, so the pressed state and the click are
 * the same fact and cannot drift.
 */
// Type-only: pulls the `rail.item` seat declaration from the shell that owns it.
import type {} from '@deepseek-ai/dsh-client-ui-sci-shell/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { AgentGlyph } from './icons.tsx'
import { AGENTS_VIEW } from './view-id.ts'
import css from './RailItem.module.css'

/** Glyph edge length inside a rail tile, in CSS pixels. */
const GLYPH_SIZE = 19

/** Full props of the agent-roster rail button. */
export type AgentsRailItemProps = PropsRuntime<'rail.item'> & PropsLocale<'sci-agents'>

/**
 * Render the agents button.
 * @param props - the button's composed slot props.
 * @returns the rail tile.
 */
export function AgentsRailItem({ view, showView, t }: AgentsRailItemProps) {
  const active = view === AGENTS_VIEW
  const label = t('rail.agents')
  return (
    <button
      type="button"
      className={active ? `${css.tile} ${css.tileActive}` : css.tile}
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={() => { showView(AGENTS_VIEW) }}
    >
      <AgentGlyph size={GLYPH_SIZE} />
    </button>
  )
}
