/**
 * The sci reading of one selected tool call, replacing the built-in details
 * body at a lower shadowing priority.
 *
 * The built-in body is card-aware: it recognizes a terminal, a read, a diff,
 * a search, and shows each in its own shape. This one names the call and shows
 * what came back verbatim instead, because in a research session the
 * interesting calls are literature searches, document writes, and sub-agent
 * runs, none of which have a built-in card.
 *
 * Neither the arguments nor a heading for the result are here: the owner
 * renders both around this seat (`ui-conversation`'s DetailsPanel puts the
 * arguments in its Input section and mounts this one under its Output
 * heading), so the occupant is the result itself, titled by the call it
 * belongs to.
 *
 * There is no step timeline here either. The wire carries a call and a result,
 * not progress between them, so a running call gets an honest stopwatch and
 * nothing else.
 */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { toolDisplayName } from './tool-names.ts'
import css from './SciToolDetails.module.css'

/** Full props of the sci details body. */
export type SciToolDetailsProps = PropsRuntime<'conversation.details.tool'> & PropsLocale<'sci-files'>

/** Result text past this many characters is cut, with the cut announced. */
const RESULT_MAX = 20_000

/** Stopwatch tick for a call that has not settled. */
const TICK_MS = 1000

/**
 * Render the selected call's identity, state, and result.
 * @param props - the frozen call slice and this package's locale seat.
 * @returns the details panel body.
 */
export function SciToolDetails({ block, t }: SciToolDetailsProps) {
  const settled = 'kind' in block ? block : undefined
  const running = 'kind' in block ? undefined : block
  const liveSeconds = useElapsedSeconds(running?.time ?? 0, running !== undefined)

  const toolName = settled === undefined ? running?.name : settled.call?.name
  const title = t('tool.title', { name: toolName === undefined ? t('tool.unknown') : toolDisplayName(toolName) })
  const status = settled === undefined
    ? t('tool.running')
    : settled.isError ? t('tool.failed') : t('tool.done')
  const seconds = settled === undefined
    ? liveSeconds
    : settled.callTime === null ? null : Math.round((settled.time - settled.callTime) / TICK_MS)
  const output = settled === undefined ? '' : resultText(settled)

  return (
    <div className={css.root}>
      <div className={css.head}>
        <div className={css.title}>{title}</div>
        <div className={css.state}>
          <span className={css.status} data-error={settled?.isError === true || undefined}>{status}</span>
          {seconds !== null && <span className={css.elapsed}>{t('tool.elapsed', { seconds })}</span>}
        </div>
      </div>
      {settled !== undefined && (
        <section className={css.section}>
          {output === ''
            ? <div className={css.note}>{t('tool.result.empty')}</div>
            : (
              <pre className={settled.isError ? `${css.block} ${css.blockError}` : css.block}>
                {output.slice(0, RESULT_MAX)}
              </pre>
            )}
          {output.length > RESULT_MAX && <div className={css.truncated}>{t('tool.truncated')}</div>}
        </section>
      )}
    </div>
  )
}

/**
 * Seconds since `since`, recomputed every second while `active`. A settled
 * call passes `active: false`, so a details panel left open on finished work
 * runs no timer.
 * @param since - unix epoch ms the call started at.
 * @param active - whether the call is still running.
 * @returns whole seconds elapsed, never negative.
 */
function useElapsedSeconds(since: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => { setNow(Date.now()) }, TICK_MS)
    return () => { clearInterval(timer) }
  }, [active])
  return Math.max(0, Math.round((now - since) / TICK_MS))
}

/**
 * A settled result's content flattened to display text: text blocks verbatim,
 * every other block as indented JSON. A failed call whose content is empty
 * falls back to its structured error line, so the panel never shows a failure
 * with nothing in it.
 * @param node - the settled result node.
 * @returns the flattened text, possibly empty.
 */
function resultText(node: ToolResultNode): string {
  const parts = node.content.map(part => (part.type === 'text' ? part.text : JSON.stringify(part, null, 2)))
  if (parts.length === 0 && node.error !== undefined) return `${node.error.name}: ${node.error.code}`
  return parts.join('\n')
}
