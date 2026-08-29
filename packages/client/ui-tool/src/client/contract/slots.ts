/** Tool UI slot declarations and their composed component props. */
import type { ReactNode } from 'react'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Keyed atomic Tool call view, dispatched by the wire Tool name. Register
     * with `key: '<tool name>'` to own how one tool's calls render inside a
     * turn — the key domain is open (any wire tool name, including a tool your
     * own package registered), so there is no compile-time key set to pick
     * from and a typo simply never renders.
     *
     * A key the shipped composition already covers is replaced, not shared;
     * an unclaimed key falls back to the generic tool row, so registering is
     * additive for your own tool and a takeover for a shipped one. The owner
     * passes the call's identity, its frozen running-or-settled node, and the
     * expansion state (see ToolCallOwnerProps), so the view stays a pure
     * function of what the turn already knows.
     */
    'tool.call.toolview': { kind: 'keyed'; scope: 'session'; owner: ToolCallOwnerProps }
    /**
     * The chrome around one Tool call — head, disclosure, and whatever else a
     * profile wants every call to wear. One occupant, and taking it replaces
     * the shipped row wholesale.
     *
     * It exists because the alternative does not work: shadowing the
     * `tool-call` Chat Node entry would also shadow that entry's `children`
     * declaration, and a child slot admits exactly one declarer, so the
     * takeover could never re-declare {@link SlotMap['tool.call.toolview']}
     * and every registered per-tool view would stop rendering. Framing here
     * instead keeps that dispatch where it is: the owner hands the occupant
     * the already-dispatched per-tool view as `body`, so a profile restyles
     * every call without knowing a single tool.
     *
     * The occupant owns no identity. The anchor and selection attributes the
     * chat view scrolls by and the details column highlights by stay on the
     * owner's wrapper, outside whatever the occupant renders.
     */
    'tool.call.frame': { kind: 'single'; scope: 'session'; owner: ToolCallFrameOwnerProps }
  }
}

/** Standard owner currency supplied to every atomic Tool view. */
export interface ToolCallOwnerProps {
  /** Tool call identity, stable across running and settled forms. */
  callId: string
  /** Wire Tool name and keyed dispatch value. */
  toolName: string
  /** Frozen running call or settled result node. */
  block: ToolCallBlock
  /** Session workspace root for relative summaries. */
  cwd?: string | undefined
  /** Host account home; POSIX home-rooted summaries display as `~`. */
  home?: string | undefined
  /** Open a Tool argument path through the Host. */
  openFile: (path: string) => void
  /** Inspect this call in the trajectory view when available. */
  inspect?: (() => void) | undefined
}

/**
 * Owner currency of the Tool call frame: one call's identity and lifecycle,
 * the two gestures its chrome can offer, and the two already-rendered regions
 * the frame is responsible for placing.
 *
 * `body` and `children` are ReactNode owner props, which the client props
 * discipline otherwise routes through slots. They are deliberate here and
 * bounded: both are produced by this package's own render site from slots it
 * declares, and moving either to a slot of its own would hand the frame's
 * occupant a declaration it cannot have (see the slot's own note).
 */
export interface ToolCallFrameOwnerProps {
  /** Tool call identity, stable across running and settled forms. */
  callId: string
  /** Wire Tool name; the frame titles and groups by it. */
  toolName: string
  /** Frozen running call or settled result node — the frame's own state source. */
  block: ToolCallBlock
  /** Whether the details column currently names this call. */
  selected: boolean
  /**
   * Engine-owned turn this call belongs to; null when the Node's placement is
   * unresolved. Supplied because a settled result node carries no turn of its
   * own, so a frame that shows turn-wide context (sibling delegations, turn
   * timing) would otherwise have to scan the Chat Node store to find it.
   */
  turn: number | null
  /** Session workspace root for relative summaries. */
  cwd?: string | undefined
  /** Host account home; POSIX home-rooted summaries display as `~`. */
  home?: string | undefined
  /** Inspect this call in the trajectory view; absent when that view is not composed. */
  inspect?: (() => void) | undefined
  /** Select this call and open the details column on its `tool` mode. */
  openDetails: () => void
  /** This call's per-tool view, already dispatched through the keyed seat. */
  body: ReactNode
  /** Whether this call owns child calls, for chrome that announces them. */
  hasSubcalls: boolean
  /** The recursive subcall branch, already rendered; absent for a leaf call. */
  children?: ReactNode | undefined
}

/** Full props of a registered Tool call frame. */
export type ToolCallFrameProps = PropsRuntime<'tool.call.frame'>

/** Full props of a registered atomic Tool view. */
export type ToolCallViewProps = PropsRuntime<'tool.call.toolview'>

/** Injected Host description for POSIX home-path display. */
export type ToolHostDescriptionInjected = {
  hooks: {
    /** Current generation's Host description, bound by the slot renderer. */
    hostDescription: HostDescriptionSource
  }
}

/** Full props of the Tool call-tree renderer registered as a `tool-call` Chat Node. */
export type ToolTreeProps = PropsRuntime<'conversation.chat.node', 'tool-call'>
  & PropsRenderSlots<'tool.call.toolview' | 'tool.call.frame'>
  & PropsLocale<'conversation'>
  & InjectFace<ToolHostDescriptionInjected>

/** Full props of the selected Tool output renderer in the details panel. */
export type ToolDetailsProps = PropsRuntime<'conversation.details.tool'>
  & PropsLocale<'conversation'>
  & InjectFace<ToolHostDescriptionInjected>
