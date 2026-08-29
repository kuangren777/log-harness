/**
 * The composed prop shares of this package's three registrations.
 *
 * Every one is a plain `PropsRuntime` over the seat it occupies plus this
 * package's own locale namespace — the copy (card states, board headings,
 * chip labels) lives in this dictionary, and an entry's `t` is typed to the
 * namespace it declares.
 *
 * The tool card occupies ui-tool's `tool.call.frame` rather than shadowing
 * the `tool-call` Chat Node. Shadowing would also shadow that Node entry's
 * `children` declaration, and a child slot admits exactly one declarer, so
 * the takeover could never re-declare `tool.call.toolview` and every
 * per-tool view would stop rendering. Framing keeps that dispatch in
 * ui-tool: the owner hands this card the already-rendered per-tool view as
 * `body`, so the workbench restyles every call and displaces none of them.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the SlotMap merges for the turn-tail and header-action
// seats this package registers into.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the SlotMap merge declaring `tool.call.frame`.
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'

/** Full props of this package's Tool call frame. */
export type SciToolCardProps = PropsRuntime<'tool.call.frame'>
  & PropsLocale<'sci-conversation'>

/** The one gesture the artifact chips drive; a test double owes nothing more. */
export interface ArtifactsLocate {
  /** Pin one produced path in the files mode and bring that mode forward. */
  locate: (path: string) => void
}

/** The one gesture the header action drives. */
export interface ArtifactsPanel {
  /** Bring one details-column mode forward. */
  showDetailsMode: (id: string) => void
}

/** Full props of the turn-tail artifact chips. */
export type ArtifactChipsProps = PropsRuntime<'conversation.chat.turnTail'>
  & PropsLocale<'sci-conversation'>
  & InjectFace<ArtifactsLocate>
  & { matched: readonly string[] }

/** Full props of the session header's open-output action. */
export type OpenArtifactsActionProps = PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'sci-conversation'>
  & InjectFace<ArtifactsPanel>
