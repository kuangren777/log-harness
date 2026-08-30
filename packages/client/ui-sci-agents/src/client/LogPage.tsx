/**
 * One persona's delegation log: when it was called, with what task, how long
 * it took, and how it ended.
 *
 * Every row is the audit record of a real delegation, and activating one
 * reopens the session that made it — the log is a way back into the research
 * flow, not a read-only report. The token column appears only when at least
 * one settlement carried usage, because a column of dashes would claim the
 * host measures something it does not.
 */
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { AgentCall, AgentCallStatus, RosterAgent } from './contract.ts'
import type { SciAgentsKey } from './locales.ts'
import { PageHeader } from './PageHeader.tsx'
import { formatClock, formatDuration, formatTokens } from './format.ts'
import css from './LogPage.module.css'

/** Dictionary key per call status, so the labels stay statically checked. */
const STATUS_KEYS: Readonly<Record<AgentCallStatus, SciAgentsKey>> = {
  ok: 'call.ok',
  error: 'call.error',
  running: 'call.running',
}

/** What a cell reads when this row carries no value for a shown column. */
const ABSENT = '—'

/** Class per call status, so a failure reads as one at a glance. */
const STATUS_CLASSES: Readonly<Record<AgentCallStatus, string | undefined>> = {
  ok: css.status,
  error: css.failed,
  running: css.running,
}

/** Owner-controlled log-page props. */
export interface LogPageProps {
  /** The persona whose log this is. */
  agent: RosterAgent
  /** Its position in the roster, which picks the header glyph. */
  glyphAt: number
  /** The log, or undefined while the read is still out. */
  calls: readonly AgentCall[] | undefined
  /** The failure code of the log read, or undefined. */
  error: string | undefined
  /** Return to the roster. */
  onBack: () => void
  /** Open the session that made one delegation. */
  onOpen: (sessionId: string) => void
  /** Localized log copy. */
  t: Translate<SciAgentsKey>
}

/**
 * Render the delegation log.
 * @param props - the page's owner-controlled props.
 * @returns the table under the persona header, or the state that replaces it.
 */
export function LogPage({ agent, glyphAt, calls, error, onBack, onOpen, t }: LogPageProps) {
  const rows = calls ?? []
  const withTokens = rows.some(call => call.outputTokens !== undefined)
  return (
    <div className={css.root}>
      <PageHeader
        glyphAt={glyphAt}
        title={t('page.log', { name: agent.name })}
        role={agent.role}
        onBack={onBack}
        t={t}
      />
      {error !== undefined && (
        <div className={css.error} role="alert">{t('roster.error', { code: error })}</div>
      )}
      {error === undefined && rows.length === 0 && (
        <p className={css.empty}>{calls === undefined ? t('log.loading') : t('log.empty')}</p>
      )}
      {rows.length > 0 && (
        <table className={css.table}>
          <caption className={css.caption}>{t('log.table')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('log.time')}</th>
              <th scope="col">{t('log.task')}</th>
              <th scope="col">{t('log.duration')}</th>
              <th scope="col">{t('log.status')}</th>
              {withTokens && <th scope="col">{t('log.tokens')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((call) => {
              const time = formatClock(call.ts)
              const status = t(STATUS_KEYS[call.status])
              const open = (): void => { onOpen(call.sessionId) }
              return (
                <tr
                  key={call.callId}
                  className={css.row}
                  tabIndex={0}
                  aria-label={t('log.row', { time, task: call.task, status })}
                  onClick={open}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    open()
                  }}
                >
                  <td className={css.mono}>{time}</td>
                  <td className={css.task}>{call.task}</td>
                  <td className={css.mono}>
                    {/* A settled call with no timing row (a refusal spawns no child) has no
                        duration to claim — 进行中 would contradict the settled status beside it. */}
                    {call.durationMs !== undefined
                      ? formatDuration(call.durationMs)
                      : call.status === 'running' ? t('log.pending') : '—'}
                  </td>
                  <td className={STATUS_CLASSES[call.status]}>{status}</td>
                  {withTokens && (
                    <td className={css.mono}>
                      {call.outputTokens === undefined ? ABSENT : formatTokens(call.outputTokens)}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
