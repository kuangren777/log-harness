// Skill toolview registrant: a domain-owned row over the keyed toolview hole.
// The compact accent row keeps loaded instructions scannable in the transcript;
// the exact durable tool output remains available in a bounded disclosure card.

import { useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconInspectOutline12, IconSkillOutline16, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SkillRow.module.css'

/** Skill row lifecycle derived solely from the durable call slice. */
type SkillRowState = 'running' | 'ok' | 'error' | 'stopped'

/** Full row props: the toolview runtime share plus this package's locale seat. */
type SkillRowProps = ToolCallViewProps & PropsLocale<'skill'>

/** Compact, replay-stable view model for the dedicated row. */
interface SkillRowModel {
  readonly name: string
  readonly output: string | null
  readonly errorSummary: string | null
  readonly state: SkillRowState
  /** sha256 of the first `referenced-text` result block, else null (inline result). */
  readonly digest: string | null
}

/** First physical line for the collapsed error summary and malformed-args fallback. */
function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** Skill names are the only call argument the compact row presents. */
function skillName(argsRaw: string, callId: string): string {
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      const name = (parsed as Record<string, unknown>).name
      if (typeof name === 'string' && name !== '') return firstLine(name)
    }
  } catch {
    // Streaming can expose a truncated JSON prefix; its first line is still
    // more useful than replacing the call with an unrelated catalog lookup.
  }
  return argsRaw === '' ? callId : firstLine(argsRaw)
}

/**
 * Structural test for the `referenced-text` content block. `dsh-referenced-text`
 * merges this member into `ContentBlockMap` (`@deepseek-ai/dsh-llm`), but this
 * package's compiler face (`tsconfig.json` -> `client/runtime` -> `llm/llm`)
 * never references `attachment/referenced-text`, so the local `ContentBlock`
 * union has no `'referenced-text'` member: a `item is {type: 'referenced-text'}`
 * type predicate would narrow the true branch to `never` (no discriminant
 * overlap), so this returns a plain `boolean` and callers cast explicitly.
 */
function isReferencedTextBlock(item: unknown): boolean {
  return typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'referenced-text'
}

/** Read `sha256` off a content item already known to satisfy {@link isReferencedTextBlock}. */
function referencedTextSha256(item: unknown): string {
  const sha256 = (item as { sha256?: unknown }).sha256
  return typeof sha256 === 'string' ? sha256 : ''
}

/** Flatten durable result blocks under the generic Tool-row text contract.
 *  Keep aligned with ui-tool's models/tool-call-model.ts `resultText`; a
 *  `referenced-text` block is omitted here on purpose — the row never shows
 *  a referenced skill body, only its digest (see `referenceDigest`). */
function resultText(block: ToolCallViewProps['block']): string | null {
  if (!('kind' in block)) return null
  const parts: string[] = []
  for (const item of block.content) {
    if (isReferencedTextBlock(item)) continue
    parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  }
  if (parts.length === 0 && block.error !== undefined) {
    parts.push(`${block.error.name}: ${block.error.code}`)
  }
  return parts.join('\n') || null
}

/** The sha256 of the first `referenced-text` block in the settled result, else null. */
function referenceDigest(block: ToolCallViewProps['block']): string | null {
  if (!('kind' in block)) return null
  for (const item of block.content) {
    if (isReferencedTextBlock(item)) return referencedTextSha256(item)
  }
  return null
}

/** Derive display state without consulting the live skill catalog. */
function skillRowModel(block: ToolCallViewProps['block']): SkillRowModel {
  const settled = 'kind' in block
  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  const state: SkillRowState = !settled
    ? 'running'
    : block.error?.code === 'interrupted'
      ? 'stopped'
      : block.isError ? 'error' : 'ok'
  const digest = referenceDigest(block)
  const flattened = resultText(block)
  const output = digest === null ? flattened : null
  return {
    name: skillName(argsRaw, block.callId),
    output,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
    state,
    digest,
  }
}

/** State substitution for the collapsed leading slot. */
function leadingFor(state: SkillRowState): ReactNode {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    default: return <IconSkillOutline16 size={14} />
  }
}

/** Leading disclosure slot: state icon at rest, chevron on hover or while open. */
function disclosureLeading(state: SkillRowState, open: boolean, expandable: boolean): ReactNode {
  if (open) return <IconChevronDownOutline14 className={css.chevron} />
  const icon = leadingFor(state)
  if (!expandable) return icon
  return (
    <>
      <span className={css.iconIdle}>{icon}</span>
      <IconChevronDownOutline14 className={`${css.chevron} ${css.chevronHover}`} />
    </>
  )
}

/** Visually hidden state copy for the colour-only lifecycle cues. */
function stateStatus(state: SkillRowState, t: SkillRowProps['t']): string | null {
  switch (state) {
    case 'running': return t('row.running')
    case 'error': return t('row.failed')
    case 'stopped': return t('row.stopped')
    default: return null
  }
}

/**
 * Render one `skill` tool call as an accent summary and instructions disclosure.
 * @param props - keyed toolview payload plus the skill locale seat.
 * @returns the dedicated skill row.
 */
export function SkillRow({ block, inspect, t }: SkillRowProps) {
  const model = skillRowModel(block)
  const [expanded, setExpanded] = useState(false)
  const expandable = model.output !== null
  const open = expanded && expandable
  const status = stateStatus(model.state, t)
  const summary = model.errorSummary ?? (model.digest === null
    ? model.name
    : `${t('row.loaded')} ${model.name} · ${model.digest.slice(0, 8)}`)
  const toggleExpand = (): void => {
    setExpanded(value => !value)
  }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    toggleExpand()
  }
  const disclosureProps = expandable ? {
    role: 'button' as const,
    tabIndex: 0,
    'aria-expanded': open,
    onClick: toggleExpand,
    onKeyDown: toggleFromKeyboard,
  } : {}
  const leading = disclosureLeading(model.state, open, expandable)
  return (
    <div className={css.card} data-tool="skill" data-state={model.state}>
      <div
        className={css.row}
        data-expandable={expandable || undefined}
        {...disclosureProps}
      >
        <span className={css.leading}>{leading}</span>
        {status !== null ? <span className={css.visuallyHidden}>{status}</span> : null}
        <span className={css.title}>Skill</span>
        <span className={css.separator} aria-hidden />
        <span className={model.errorSummary === null ? css.summary : `${css.summary} ${css.errorSummary}`}>
          {summary}
        </span>
      </div>
      {open ? (
        <div className={css.bodyWrap}>
          <section className={css.instructionsCard} aria-label={t('row.instructions')}>
            <div className={css.instructionsHeader}>{t('row.instructions')}</div>
            <pre className={css.instructions} data-error={model.state === 'error' || undefined}>{model.output}</pre>
          </section>
          {inspect !== undefined ? (
            <button type="button" className={css.inspectButton} onClick={inspect}>
              <IconInspectOutline12 />
              Inspect
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
