/**
 * The roster page: one card per persona the host mounts, over a subtitle that
 * counts them.
 *
 * Both numbers in the subtitle and all three tiles on a card are the host's:
 * the enrolled count is how many personas are enabled, the delegation count
 * is the sum of their real month counts, and a persona whose average duration
 * or token total the host could not compute loses that tile instead of
 * showing a zero.
 */
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { AgentCall, RosterAgent } from './contract.ts'
import type { RosterStatus } from './stores.ts'
import type { SciAgentsKey } from './locales.ts'
import { formatCount, formatDuration, formatTokens, glyphOf } from './format.ts'
import css from './RosterPage.module.css'

/** Owner-controlled roster-page props. */
export interface RosterPageProps {
  /** The roster in host order; the card glyphs follow that order. */
  agents: readonly RosterAgent[]
  /** Delegation logs by persona id, for the status pill. */
  logs: Readonly<Record<string, readonly AgentCall[]>>
  /** Where the roster read stands. */
  status: RosterStatus
  /** The failure code of the roster read, or null. */
  error: string | null
  /** Open one persona's configuration page. */
  onConfigure: (persona: string) => void
  /** Open one persona's delegation log. */
  onLog: (persona: string) => void
  /** Localized roster copy. */
  t: Translate<SciAgentsKey>
}

/** One card's props. */
interface AgentCardProps {
  /** The persona this card is about. */
  agent: RosterAgent
  /** Its position in the roster, which picks the card glyph. */
  index: number
  /** That persona's delegation log, as far as it has been read. */
  calls: readonly AgentCall[]
  /** Open this persona's configuration page. */
  onConfigure: () => void
  /** Open this persona's delegation log. */
  onLog: () => void
  /** Localized card copy. */
  t: Translate<SciAgentsKey>
}

/**
 * One stat tile, drawn only for a value the host reported.
 * @param label - the tile's caption.
 * @param value - the reading.
 * @returns the tile.
 */
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className={css.tile}>
      <div className={css.tileValue}>{value}</div>
      <div className={css.tileLabel}>{label}</div>
    </div>
  )
}

/**
 * Render one roster card.
 * @param props - the card's owner-controlled props.
 * @returns the card.
 */
function AgentCard({ agent, index, calls, onConfigure, onLog, t }: AgentCardProps) {
  const running = calls.some(call => call.status === 'running')
  const state = !agent.enabled
    ? { label: t('status.disabled'), className: `${css.pill} ${css.pillOff}` }
    : running
      ? { label: t('status.running'), className: `${css.pill} ${css.pillRunning}` }
      : { label: t('status.standby'), className: `${css.pill} ${css.pillStandby}` }
  return (
    <div className={css.card}>
      <div className={css.head}>
        <span className={css.glyph} aria-hidden="true">{glyphOf(index)}</span>
        <div className={css.identity}>
          <div className={css.name}>{agent.name}</div>
          <div className={css.role}>{agent.role}</div>
        </div>
        <span className={state.className}>
          <span className={css.dot} aria-hidden="true" />
          {state.label}
        </span>
      </div>
      <p className={css.summary}>{agent.summary}</p>
      <div className={css.tiles}>
        <Tile label={t('stat.calls')} value={formatCount(agent.stats.monthCalls)} />
        {agent.stats.avgDurationMs !== undefined && (
          <Tile label={t('stat.duration')} value={formatDuration(agent.stats.avgDurationMs)} />
        )}
        {agent.stats.monthTokens !== undefined && (
          <Tile label={t('stat.tokens')} value={formatTokens(agent.stats.monthTokens)} />
        )}
      </div>
      <div className={css.actions}>
        <button type="button" className={css.secondary} onClick={onConfigure}>
          {t('card.configure')}
        </button>
        <button type="button" className={css.primary} onClick={onLog}>
          {t('card.log')}
        </button>
      </div>
    </div>
  )
}

/**
 * Render the roster page.
 * @param props - the page's owner-controlled props.
 * @returns the header over the card grid, or the state that replaces it.
 */
export function RosterPage({ agents, logs, status, error, onConfigure, onLog, t }: RosterPageProps) {
  const enabled = agents.filter(agent => agent.enabled).length
  const delegations = agents.reduce((sum, agent) => sum + agent.stats.monthCalls, 0)
  return (
    <div className={css.root}>
      <div className={css.header}>
        <h1 className={css.title}>{t('roster.title')}</h1>
        {/* The subtitle's numbers are the host's; before the roster lands there
            is nothing truthful to count, so the line waits with the grid. */}
        {agents.length > 0 && (
          <div className={css.subtitle}>
            {t('roster.subtitle', { enabled, calls: formatCount(delegations) })}
          </div>
        )}
      </div>
      {status === 'error' && (
        <div className={css.error} role="alert">{t('roster.error', { code: error })}</div>
      )}
      {agents.length === 0 && status !== 'error' && (
        <p className={css.empty}>{status === 'loading' ? t('roster.loading') : t('roster.empty')}</p>
      )}
      {agents.length > 0 && (
        <div className={css.grid}>
          {agents.map((agent, index) => (
            <AgentCard
              key={agent.persona}
              agent={agent}
              index={index}
              calls={logs[agent.persona] ?? []}
              onConfigure={() => { onConfigure(agent.persona) }}
              onLog={() => { onLog(agent.persona) }}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  )
}
