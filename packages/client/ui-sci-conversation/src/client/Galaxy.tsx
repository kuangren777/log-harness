/**
 * The agent galaxy: the delegating call's own body, showing every agent the
 * turn dispatched around one centre.
 *
 * Pure presentation over what `./select.ts` derived. The orbit is decorative
 * and `aria-hidden`; the list beside it is the accessible reading, and it is
 * the list that carries the real numbers. The token column exists only when
 * at least one call reported tokens — a column of dashes would claim the
 * board knows something it does not.
 */
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { SciConversationKey } from './locales.ts'
import type { GalaxyAgent } from './galaxy-select.ts'
import css from './Galaxy.module.css'

/** Orbit glyphs, in dispatch order; a run wider than the alphabet numbers instead. */
const GLYPHS = 'αβγδεζ'

/** How many badges the decorative orbit carries before it stops adding them. */
const ORBIT_SLOTS = GLYPHS.length

/** Board props: the derived agents, the turn's header readings, and the locale seat. */
export interface GalaxyProps {
  /** The turn's delegated calls, in dispatch order. */
  agents: readonly GalaxyAgent[]
  /** Turn wall time in ms, or null when the turn's start is outside the window. */
  turnElapsedMs: number | null
  /** Summed assistant output tokens of the turn, or null when none were recorded. */
  turnOutputTokens: number | null
  /** Whether the turn is still open. */
  turnRunning: boolean
  /** This package's bound dictionary. */
  t: Translate<SciConversationKey>
}

/**
 * The badge glyph of the nth agent.
 * @param index - dispatch position.
 * @returns a Greek letter, or the 1-based position past the alphabet.
 */
export function agentGlyph(index: number): string {
  return GLYPHS[index] ?? String(index + 1)
}

/** Whole seconds of a wall time, for the one-decimal-free readings the board shows. */
function seconds(milliseconds: number): string {
  return String(Math.max(0, Math.round(milliseconds / 1_000)))
}

/**
 * Render the galaxy board.
 * @param props - the derived agents and turn readings.
 * @returns the board, or the empty statement when the turn delegated nothing.
 */
export function Galaxy({ agents, turnElapsedMs, turnOutputTokens, turnRunning, t }: GalaxyProps) {
  if (agents.length === 0) return <div className={css.empty}>{t('galaxy.empty')}</div>
  const showTokens = agents.some(agent => agent.outputTokens !== null)
  return (
    <div className={css.board}>
      <div className={css.header}>
        <span className={css.title}>{t('galaxy.title')}</span>
        <span className={css.readings}>
          {turnElapsedMs !== null && (
            <span className={css.reading}>{t('galaxy.turnElapsed', { seconds: seconds(turnElapsedMs) })}</span>
          )}
          {turnOutputTokens !== null && (
            <span className={css.reading}>{t('galaxy.turnTokens', { tokens: String(turnOutputTokens) })}</span>
          )}
          {turnRunning && <span className={css.live}>{t('card.running')}</span>}
        </span>
      </div>
      <div className={css.stage}>
        <div className={css.orbit} aria-hidden data-sci-motion>
          <div className={css.ring}>
            {agents.slice(0, ORBIT_SLOTS).map((agent, index) => (
              <span
                key={agent.callId}
                className={css.badge}
                data-slot={index}
                data-status={agent.status}
              >
                {agentGlyph(index)}
              </span>
            ))}
          </div>
          <div className={css.core}>
            <span className={css.coreName}>{t('galaxy.center')}</span>
            <span className={css.coreRole}>{t('galaxy.centerRole')}</span>
          </div>
        </div>
        <ul className={css.list}>
          {agents.map((agent, index) => (
            <li key={agent.callId} className={css.row}>
              <span className={css.rowGlyph} data-status={agent.status}>{agentGlyph(index)}</span>
              <span className={css.rowBody}>
                <span className={css.rowHead}>
                  <span className={css.rowLabel}>{agent.label}</span>
                  <span className={css.rowMeta}>
                    {agent.elapsedMs !== null && (
                      <span>{t('card.elapsed', { seconds: seconds(agent.elapsedMs) })}</span>
                    )}
                    {showTokens && agent.outputTokens !== null && (
                      <span>{`${agent.outputTokens} ${t('galaxy.columnTokens')}`}</span>
                    )}
                  </span>
                </span>
                <span className={css.track}>
                  <span className={css.fill} data-status={agent.status} data-sci-motion />
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
