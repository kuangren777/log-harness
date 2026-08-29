/** Root/subcall Tool composition with one keyed atomic dispatch path. */
import { memo, useMemo, type ReactNode } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { SelectionTarget } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolCallFrameOwnerProps, ToolCallOwnerProps, ToolTreeProps } from '../contract/slots.ts'
import { GenericToolCard } from './toolviews/GenericToolCard.tsx'
import css from './ToolCallTree.module.css'

/** Resolve a Tool call's wire name from either lifecycle form. */
function callName(node: ToolCallBlock): string {
  return 'kind' in node ? node.call?.name ?? '' : node.name
}

/**
 * The engine-owned turn a Tool Chat Node sits in.
 * @param location - the Node's placement.
 * @returns the turn number, or null when the placement is unresolved.
 */
export function frameTurn(location: ToolTreeProps['node']['location']): number | null {
  return location.kind === 'turn' || location.kind === 'step' ? location.turn.turn : null
}

/**
 * The details-column selection one call's frame gesture names.
 *
 * The seqs are the Node's engine-owned boundary events, not its anchor: the
 * details column addresses a call inside a turn and a step, and those two
 * events are what identify them. A window cut that left a boundary outside
 * falls back to the anchor, which is always in-window.
 * @param node - the Tool Chat Node the call belongs to.
 * @param callId - the call the gesture addresses.
 * @param toolName - that call's wire name, for the panel's title.
 * @returns the selection target.
 */
export function frameSelection(
  node: ToolTreeProps['node'],
  callId: string,
  toolName: string,
): SelectionTarget {
  const location = node.location
  const inTurn = location.kind === 'turn' || location.kind === 'step'
  const turnSeq = inTurn ? location.turn.start?.seq ?? node.anchorSeq : node.anchorSeq
  const stepSeq = location.kind === 'step' ? location.step.start?.seq : undefined
  return stepSeq === undefined
    ? { turnSeq, callId, toolName }
    : { turnSeq, stepSeq, callId, toolName }
}

/** One atomic call dispatched through the Tool-owned keyed slot. */
const ToolCall = memo(function ToolCall({
  renderSlot, callId, toolName, block, openFile, selected, cwd, home, inspectCall, openDetails, node, t, children,
}: Pick<ToolTreeProps, 'renderSlot' | 'openFile' | 'cwd' | 'inspectCall' | 'openDetails' | 'node' | 't'> & {
  callId: string
  toolName: string
  block: ToolCallBlock
  selected: boolean
  home?: string | undefined
  children?: ReactNode
}) {
  const owner: ToolCallOwnerProps = useMemo(() => ({
    callId,
    toolName,
    block,
    openFile,
    cwd,
    home,
    inspect: () => { inspectCall(callId) },
  }), [callId, toolName, block, openFile, cwd, home, inspectCall])
  // The per-tool dispatch happens here whether or not a frame is occupied:
  // the frame receives the resulting element, so occupying the frame restyles
  // every call without displacing a single tool's own view.
  const body = renderSlot('tool.call.toolview', owner, {
    entryKey: toolName,
    fallback: <GenericToolCard {...owner} t={t} />,
  })
  const frameOwner: ToolCallFrameOwnerProps = {
    ...owner,
    selected,
    turn: frameTurn(node.location),
    openDetails: () => { openDetails(frameSelection(node, callId, toolName)) },
    body,
    hasSubcalls: block.subCalls.length > 0,
    children,
  }
  return (
    <div
      className={css.callRow}
      data-chat-anchor-key={`call:${callId}`}
      data-chat-call-id={callId}
      data-selected={selected || undefined}
    >
      {renderSlot('tool.call.frame', frameOwner, {
        fallback: <>{body}{children}</>,
      })}
    </div>
  )
})

const ToolCallBranch = memo(function ToolCallBranch({
  renderSlot, block, selectedCallId, cwd, home, openFile, inspectCall, openDetails, node, t,
}: Pick<
  ToolTreeProps,
  'renderSlot' | 'selectedCallId' | 'cwd' | 'openFile' | 'inspectCall' | 'openDetails' | 'node' | 't'
> & {
  block: ToolCallBlock
  home?: string | undefined
}) {
  return (
    <ToolCall
      renderSlot={renderSlot}
      callId={block.callId}
      toolName={callName(block)}
      block={block}
      openFile={openFile}
      selected={block.callId === selectedCallId}
      cwd={cwd}
      home={home}
      inspectCall={inspectCall}
      openDetails={openDetails}
      node={node}
      t={t}
    >
      {block.subCalls.length > 0 ? (
        <div className={css.subCalls} data-subcalls>
          {block.subCalls.map(child => (
            <ToolCallBranch
              key={child.callId}
              renderSlot={renderSlot}
              block={child}
              selectedCallId={selectedCallId}
              cwd={cwd}
              home={home}
              openFile={openFile}
              inspectCall={inspectCall}
              openDetails={openDetails}
              node={node}
              t={t}
            />
          ))}
        </div>
      ) : undefined}
    </ToolCall>
  )
})

/**
 * Render one root Tool call and its recursive children through the same
 * atomic keyed dispatch.
 * @param props - whole-Tool owner data and the Tool-owned child-slot share.
 * @returns the Tool call tree.
 */
export function ToolCallTree({
  renderSlot, node, selectedCallId, cwd, openFile, inspectCall, openDetails, useHostDescription, t,
}: ToolTreeProps) {
  const home = useHostDescription(description => description?.home)
  const block = node.data.root
  return (
    <ToolCallBranch
      renderSlot={renderSlot}
      block={block}
      selectedCallId={selectedCallId}
      cwd={cwd}
      home={home}
      openFile={openFile}
      inspectCall={inspectCall}
      openDetails={openDetails}
      node={node}
      t={t}
    />
  )
}
