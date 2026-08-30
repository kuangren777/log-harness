// DetailsPanel: the details column's chrome — a mode tab strip (shown from
// the second registered mode on), the active mode's title, and the close
// button — over the body of one 'conversation.details.mode' entry. Only the
// active mode is mounted: a deselected mode leaves the tree entirely.
// DetailsToolMode is the built-in mode: the selected call's args and result,
// args as JSON, the result raw except for a terminal-card call, whose Output
// section is the command's terminal card. Both read the selection from the
// shared chat store (conversation writes, this panel reads — the
// cross-registration share the store seat exists for) and derive the call
// material from the session snapshot — no data of their own.

import { Fragment, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { shallowEqual } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot, RunningToolCall, ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { DetailsSlotProps, DetailsToolModeProps } from '../contract/slots.ts'
import type { DetailsModeTab } from '../contract/views.ts'
import { findToolCall } from '../chat/tool-node-reader.ts'
import { DEFAULT_DETAILS_MODE } from '../stores.ts'
import css from './DetailsPanel.module.css'

/** Full props composed by reference from the contract (automatic shares & injected share). */
export type DetailsPanelProps = DetailsSlotProps

/** Full props of the built-in call-inspector mode, composed by reference from the contract. */
export type DetailsToolModeComponentProps = DetailsToolModeProps

/**
 * Selected call material: the call's display name and args plus the frozen
 * block slice it came from. `block` is a snapshot-cached reference, so the
 * wrapper stays shallow-equal across unrelated snapshot frames; the settled /
 * running split is read off it with the `'kind' in block` discrimination
 * instead of duplicated as flags.
 */
interface CallMaterial {
  name: string
  argsRaw: string | null
  block: ToolCallBlock
}

/** Material of a settled result node (native call or run_code sub-dispatch). */
function settledMaterial(node: ToolResultNode, callId: string): CallMaterial {
  return { name: node.call?.name ?? callId, argsRaw: node.call?.argsRaw ?? null, block: node }
}

/** Material of an in-flight call (native call or run_code sub-dispatch). */
function runningMaterial(call: RunningToolCall): CallMaterial {
  return { name: call.name, argsRaw: call.argsRaw, block: call }
}

function materialFor(s: ConversationSnapshot, callId: string): CallMaterial | null {
  const found = findToolCall(s, callId)
  if (found === undefined) return null
  return 'kind' in found ? settledMaterial(found, callId) : runningMaterial(found)
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    // Not JSON (streaming fragment or plain text): show verbatim.
    return raw
  }
}

/** Flatten a settled result for the no-ui-tool fallback (the running form has no result yet). */
function rawResultText(block: ToolResultNode): string {
  const parts = block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`)
  return parts.join('\n')
}

/** Resolve the stored mode id against the ledger, keeping stale ids on the built-in inspector. */
function resolveActiveMode(modes: readonly DetailsModeTab[], selectedId: string): DetailsModeTab | undefined {
  return modes.find(mode => mode.id === selectedId)
    ?? modes.find(mode => mode.id === DEFAULT_DETAILS_MODE)
}

/**
 * Renders the details column chrome around the active mode's body.
 * @param props - Selection store, mode render share, close callback, mode ledger, and locale shares.
 * @returns the tab strip (from the second mode on), the active title, and the active mode's body.
 */
export function DetailsPanel({
  useSession, useSessions, sessionId, useStore, actions, renderSlot, closeDetails, modes, t,
}: DetailsPanelProps) {
  useSyncExternalStore(modes.subscribe, modes.version)
  const tabs = modes.list()
  // `?? DEFAULT_DETAILS_MODE`: persisted snapshots from before the field
  // rehydrate without it.
  const active = resolveActiveMode(tabs, useStore(s => s.detailsMode ?? DEFAULT_DETAILS_MODE))
  const activeId = active?.id
  // Session workspace root: an omitted or relative terminal cwd resolves
  // against it, which the pure presenters cannot see.
  const sessionCwd = useSessions(list => list.byId[sessionId]?.cwd)
  const selection = useStore(s => s.selection)
  const callId = selection?.callId
  const callName = useSession(s => (callId === undefined ? undefined : materialFor(s, callId)?.name))
  // With a visible tab strip the active mode's name is already on screen, so
  // repeating it as the header would say the same thing twice; the header
  // then names the COLUMN. The built-in inspector still titles by the
  // selected call, which the tabs cannot say.
  const title = activeId === DEFAULT_DETAILS_MODE || active === undefined
    ? callName ?? selection?.toolName ?? t('details.title')
    : tabs.length > 1 ? t('details.title') : active.label

  return (
    <div className={css.root}>
      <div className={css.header}>
        <div className={css.title}>{title}</div>
        <button
          type="button" className={css.close} aria-label={t('details.close')}
          onClick={() => { closeDetails() }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {tabs.length > 1 && (
        <div className={css.tabs} role="tablist">
          {tabs.map(mode => (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={mode.id === activeId}
              className={clsx(css.tab, mode.id === activeId && css.tabActive)}
              onClick={() => { actions.setDetailsMode(mode.id) }}
            >
              {mode.label}
            </button>
          ))}
        </div>
      )}
      {activeId !== undefined
        && renderSlot('conversation.details.mode', { sessionId, cwd: sessionCwd, active: true }, { only: activeId })}
    </div>
  )
}

/**
 * Renders the selected call's input and output as the built-in details mode.
 * @param props - Selection store, Tool output seat, and locale shares.
 * @returns the call's Input/Output sections, or the empty and out-of-window states.
 */
export function DetailsToolMode({ useSession, useStore, renderSlot, cwd, t }: DetailsToolModeComponentProps) {
  const selection = useStore(s => s.selection)
  const callId = selection?.callId
  // materialFor builds a fresh wrapper; shallowEqual short-circuits on its
  // stable members (result node reference rides the snapshot's structural sharing).
  const material = useSession(
    s => (callId === undefined ? null : materialFor(s, callId)),
    (a, b) => shallowEqual(a, b))

  return (
    <div className={css.body}>
      {selection === null || callId === undefined
        ? <div className={css.empty}>{t('details.empty')}</div>
        : material === null
          ? <div className={css.empty}>{t('details.notInWindow')}</div>
          : (
            <>
              {material.argsRaw !== null && (
                <section className={css.section}>
                  <div className={css.sectionLabel}>{t('details.input')}</div>
                  <CodeBlock code={pretty(material.argsRaw)} lang="json" copyLabel={t('copy')} copiedLabel={t('copied')} />
                </section>
              )}
              <section className={css.section}>
                <div className={css.sectionLabel}>{t('details.output')}</div>
                {/* Keyed by the selected call: the body owns per-call view
                    state (the terminal card's expand and copy), which React
                    would otherwise carry into the next selection because the
                    panel does not unmount between calls. */}
                <Fragment key={callId}>
                  {renderSlot('conversation.details.tool', { block: material.block, cwd }, {
                    fallback: 'kind' in material.block
                      ? (
                        <pre className={css.code} data-error={material.block.isError || undefined}>
                          {rawResultText(material.block)}
                        </pre>
                      )
                      : <div className={css.empty}>{t('details.running')}</div>,
                  })}
                </Fragment>
              </section>
            </>
          )}
    </div>
  )
}
