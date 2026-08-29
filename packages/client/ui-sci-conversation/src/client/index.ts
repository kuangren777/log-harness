/**
 * Sci conversation plugin, browser half: the workbench reading of the chat
 * flow.
 *
 * Five contributions, each filling or extending exactly one seat the shipped
 * conversation already owns — ui-tool's call frame, the turn-tail chain, the
 * session header's action row, one Turn-scoped hand-over accumulator, and one
 * plugin-lifetime stylesheet. Composing this plugin out of cordis.yml gives
 * every one of them back: the shipped tool row returns, ui-deliverables'
 * produced-files row wins the chain again, the header loses one button, the
 * Turn data stops being published, and the sheet comes off the document with
 * the fiber.
 *
 * The card fills `tool.call.frame` rather than shadowing the `tool-call` Chat
 * Node. Shadowing would also shadow that entry's `children` declaration, and
 * a child slot admits exactly one declarer, so the takeover could never
 * re-declare `tool.call.toolview` and every per-tool view would stop
 * rendering. Framing keeps that dispatch in ui-tool, which hands the card the
 * already-rendered view as `body`.
 *
 * The turn-tail entry registers at `priority: -10`, below ui-deliverables'
 * default 0, so it is tried first; a chain elects one winner, which is what
 * makes the chips replace that row rather than double it.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merges of the three seats registered into.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ctx.layout Context merge carrying showDetailsMode.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the ctx.sciFiles Context merge carrying locate.
import type {} from '@deepseek-ai/dsh-client-ui-sci-files/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ArtifactsLocate, ArtifactsPanel } from './contract.ts'
import { ArtifactChips } from './ArtifactChips.tsx'
import { sciArtifactsDefinition } from './artifacts-node.ts'
import { selectArtifacts } from './artifacts-select.ts'
import { OpenArtifactsAction } from './OpenArtifactsAction.tsx'
import { SciToolCard } from './SciToolCard.tsx'
import { en, NS, zh, type SciConversationKey } from './locales.ts'
import skin from './sci-conversation.css?inline'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Tool-card, galaxy, artifact-chip, and header-action copy. */
    'sci-conversation': SciConversationKey
  }
}

// Export discipline: packages/client/AGENTS.md. The Loader exports are the
// whole `/client` surface; same-package tests reach the components and the
// derivations through their own modules.

/** Required services for the registrations, the dictionaries, and the two gestures. */
export const inject = ['slots', 'locale', 'conversationEvents', 'layout', 'sciFiles']

/** Chain rank of the chip row: below ui-deliverables' default 0, so it is tried first. */
const SHADOW_PRIORITY = -10

/** This entry's position in the session header's action row. */
const ACTION_ORDER = 30

/**
 * Mount the plugin-owned conversation skin for exactly this plugin's lifetime.
 * @param ctx - client root context.
 */
function installSkin(ctx: ClientContext): void {
  /* v8 ignore next -- the jsdom suites always have a document; the guard is for a non-DOM loader host. */
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@deepseek-ai/dsh-client-ui-sci-conversation'
    tag.dataset.pluginCss = '@deepseek-ai/dsh-client-ui-sci-conversation/sci-conversation.css'
    tag.textContent = skin
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'ui-sci-conversation: conversation skin')
}

/**
 * Client plugin body: register the dictionaries, the Turn accumulator, the
 * three slot contributions, and the skin.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const locate: ArtifactsLocate = { locate: (path) => { ctx.sciFiles.locate(path) } }
  const panel: ArtifactsPanel = { showDetailsMode: (id) => { ctx.layout.showDetailsMode(id) } }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sci-conversation: dictionaries')
  installSkin(ctx)
  ctx.conversationEvents.register(sciArtifactsDefinition)

  // Ordinary priority: the frame is unoccupied until somebody takes it, so
  // there is nothing to shadow and a second occupant should fail loud.
  ctx.slots.inject('tool.call.frame', () => ctx.slots.register({
    name: 'tool.call.frame',
    locale: NS,
  }, SciToolCard))

  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    priority: SHADOW_PRIORITY,
    select: selectArtifacts,
    locale: NS,
    inject: () => locate,
  }, ArtifactChips))

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'sci-open-artifacts',
    order: ACTION_ORDER,
    locale: NS,
    inject: () => panel,
  }, OpenArtifactsAction))
}
