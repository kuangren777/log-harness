/**
 * One tool call as the workbench draws it: a card whose head is the same for
 * every tool, and whose body is whatever that tool's own view renders.
 *
 * The head is deliberately uniform — glyph, noun, argument summary, elapsed,
 * state — because a research flow is read by scanning it, and a per-tool head
 * would make every row a different scan. What each tool actually did stays
 * the tool view's business: this card occupies ui-tool's `tool.call.frame`,
 * so the per-tool view arrives already rendered as `owner.body` and the card
 * only decides when to show it. The two delegating tools are the one
 * exception, because their output is not a payload to print but a set of
 * sibling runs to watch.
 *
 * A running call opens itself and a settled one stays shut, because that is
 * the only moment the body is news. The user's own toggle then wins for as
 * long as the card lives.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconInspectOutline12, IconRightUpOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationSnapshot, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { toolDisplayName } from '@deepseek-ai/dsh-client-ui-sci-files/client'
import type { SciToolCardProps } from './contract.ts'
import { Galaxy } from './Galaxy.tsx'
import { agentCalls, callElapsedMs, turnTotals } from './galaxy-select.ts'
import type { SciConversationKey } from './locales.ts'
import { isAgentTool, toolIcon } from './tool-names.tsx'
import css from './SciToolCard.module.css'

/**
 * Longest argument summary the head prints, in characters the reader counts
 * (code points, so CJK text is not half-priced). Ten by product decision: the
 * head is an abstract of the call, never the call itself — the raw command
 * and its output live in the details column, not the stream.
 */
const SUMMARY_LIMIT = 10

/** How often a running card refreshes its live seconds. */
const TICK_MS = 1_000

/** The three states the pill names. */
export type CardStatus = 'running' | 'done' | 'error'

/**
 * A clock reading that advances once a second while `active`, and freezes
 * otherwise. Component-internal: it subscribes to nothing outside React.
 * @param active - whether the caller still needs a moving clock.
 * @returns the current epoch ms.
 */
export function useLiveNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, TICK_MS)
    return () => { clearInterval(timer) }
  }, [active])
  return now
}

/**
 * The state a call is in.
 * @param block - the call in either lifecycle form.
 * @returns its card state.
 */
export function cardStatus(block: ToolCallBlock): CardStatus {
  if (!('kind' in block)) return 'running'
  return block.isError ? 'error' : 'done'
}

/**
 * One line of what the model asked this tool to do — the ABSTRACT, never the
 * content.
 *
 * An explicit `description` argument wins when the call carries one (the
 * model's own abstract of the call); otherwise the first string argument
 * stands in — the command, the path, the query. Either way the head clamps
 * to {@link SUMMARY_LIMIT} characters, so a shell one-liner or a long query
 * never spills into the stream; the full arguments stay in the details
 * column. Newlines collapse because the head is one line.
 * @param block - the call in either lifecycle form.
 * @returns the clamped summary, or an empty string when the call names no subject.
 */
export function summarizeArgs(block: ToolCallBlock): string {
  const raw = 'kind' in block ? block.call?.argsRaw ?? '' : block.argsRaw
  let args: unknown
  try {
    args = JSON.parse(raw)
  } catch {
    return ''
  }
  if (typeof args !== 'object' || args === null) return ''
  const record = args as Record<string, unknown>
  const described = typeof record['description'] === 'string' ? [record['description']] : []
  for (const value of [...described, ...Object.values(record)]) {
    if (typeof value !== 'string') continue
    const line = value.replace(/\s+/gu, ' ').trim()
    if (line.length === 0) continue
    const points = Array.from(line)
    return points.length > SUMMARY_LIMIT ? `${points.slice(0, SUMMARY_LIMIT).join('')}…` : line
  }
  return ''
}

/** Whole seconds of a wall time. */
function seconds(milliseconds: number): string {
  return String(Math.max(0, Math.round(milliseconds / 1_000)))
}

/** The card head's state pill copy. */
function statusKey(status: CardStatus): SciConversationKey {
  if (status === 'running') return 'card.running'
  return status === 'error' ? 'card.failed' : 'card.done'
}

/** The board one delegating call shows, or the tool's own view for every other call. */
function useCardBody(
  props: Pick<SciToolCardProps, 'toolName' | 'turn' | 'body' | 'useSession' | 't'>,
  now: number,
): ReactNode {
  const { toolName, turn, body, useSession, t } = props
  const delegating = isAgentTool(toolName)
  const session = useSession((snapshot: ConversationSnapshot) => snapshot)
  const board = useMemo(() => {
    if (!delegating || turn === null) return null
    return {
      agents: agentCalls(session.chat, turn, now, toolDisplayName),
      totals: turnTotals(session, turn, now),
    }
  }, [delegating, session, turn, now])
  if (board === null) return body
  return (
    <Galaxy
      agents={board.agents}
      turnElapsedMs={board.totals.elapsedMs}
      turnOutputTokens={board.totals.outputTokens}
      turnRunning={board.totals.running}
      t={t}
    />
  )
}

/**
 * Render one tool card into ui-tool's call frame.
 * @param props - the frame owner share and this package's locale seat.
 * @returns the card.
 */
export function SciToolCard({
  toolName, block, selected, turn, inspect, openDetails, body, children, useSession, t,
}: SciToolCardProps) {
  const status = cardStatus(block)
  // Only a delegating call opens itself: its body is the live agent board.
  // Every other tool stays an abstract one-liner until the user asks — the
  // stream is for scanning, and command output belongs to the details column.
  const [open, setOpen] = useState(status === 'running' && isAgentTool(toolName))
  // The clock only moves while this call is in flight; a settled card reads
  // its elapsed off recorded timestamps and mounts no timer at all.
  const now = useLiveNow(status === 'running')
  const cardBody = useCardBody({ toolName, turn, body, useSession, t }, now)
  const elapsedMs = callElapsedMs(block, now)
  const summary = summarizeArgs(block)
  return (
    <div
      className={css.card} data-sci-tool-card data-status={status}
      data-open={open || undefined} data-card-selected={selected || undefined}
    >
      <div className={css.head}>
        <button
          type="button"
          className={css.disclosure}
          aria-expanded={open}
          aria-label={t(open ? 'card.collapse' : 'card.expand')}
          onClick={() => { setOpen(current => !current) }}
        >
          <span className={css.glyph} data-status={status} data-sci-motion>{toolIcon(toolName)}</span>
          <span className={css.name}>{toolDisplayName(toolName)}</span>
          {summary.length > 0 && <span className={css.summary}>{summary}</span>}
        </button>
        {elapsedMs !== null && <span className={css.elapsed}>{t('card.elapsed', { seconds: seconds(elapsedMs) })}</span>}
        <span className={css.pill} data-status={status}>{t(statusKey(status))}</span>
        <button
          type="button"
          className={css.action}
          aria-label={t('card.openDetails')}
          title={t('card.openDetails')}
          onClick={openDetails}
        >
          <IconRightUpOutline14 size={12} />
        </button>
        {inspect !== undefined && (
          <button
            type="button"
            className={css.action}
            aria-label={t('card.inspect')}
            title={t('card.inspect')}
            onClick={inspect}
          >
            <IconInspectOutline12 size={12} />
          </button>
        )}
        <span className={css.chevron} data-open={open || undefined} aria-hidden>
          <IconChevronDownOutline14 size={12} />
        </span>
      </div>
      {open && <div className={css.body}>{cardBody}</div>}
      {children}
    </div>
  )
}
