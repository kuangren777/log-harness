/**
 * Client-facing redaction of session events.
 *
 * The session log is the operator's record and must carry everything the model
 * saw ("model-visible ⟺ logged"); the browser is the product user's view and
 * may see less. The one redaction today withholds the descriptions of a
 * protected skill provider's catalog entries from the `<available_skills>`
 * message: a deployment that serves built-in skill bodies by reference has no
 * reason to hand their routing descriptions to the user either. The log keeps
 * the full message; only the wire copy is rewritten, and the model's request
 * is rebuilt from the log, never from a client frame.
 * @module @deepseek-ai/dsh-host-apiproxy/client-redaction
 */

import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'

/** One entry the skill-catalog message records beside its rendered text. */
interface CatalogEntry {
  readonly name: string
  readonly description: string
  readonly provider: string
}

/** The `source` a skill-catalog user message carries (`@deepseek-ai/dsh-tool-skill`). */
interface CatalogSource {
  readonly kind: 'skill-catalog'
  readonly entries: readonly CatalogEntry[]
}

/** A `user/message` event whose payload is the catalog message. */
type CatalogEvent = Extract<SessionEvent, { type: 'user/message' }>

/** Text the wire copy shows in place of a withheld description. */
export const WITHHELD_DESCRIPTION = '(built-in skill; description withheld)'

/**
 * Whether the event is a skill-catalog message whose entries carry a provider.
 * @param event - any session event.
 * @returns true for a catalog message the redaction can act on.
 */
function isCatalogEvent(event: SessionEvent): event is CatalogEvent {
  if (event.type !== 'user/message') return false
  const source = event.data.source as { kind?: unknown; entries?: unknown }
  return source.kind === 'skill-catalog' && Array.isArray(source.entries)
}

/**
 * Rewrite one rendered catalog line so a protected entry keeps its name and
 * loses its description. Lines are `- \`name\`: description`; anything else is
 * returned unchanged.
 * @param line - one line of the rendered catalog text.
 * @param protectedNames - names whose description is withheld.
 * @returns the line to send to the client.
 */
function redactLine(line: string, protectedNames: ReadonlySet<string>): string {
  const match = /^(- `([^`]+)`): /.exec(line)
  if (match === null) return line
  return protectedNames.has(match[2] as string) ? `${match[1] as string}: ${WITHHELD_DESCRIPTION}` : line
}

/**
 * Return the event as the client should see it. A skill-catalog message whose
 * entries include a protected provider comes back as a new event with those
 * entries' descriptions replaced in both the recorded `entries` and the
 * rendered text; every other event, and a catalog with nothing to withhold,
 * is returned as the same instance.
 * @param event - the logged event.
 * @param protectedProviders - skill providers whose descriptions the client must not see.
 * @returns the event to serialize to the client.
 */
export function redactEventForClient(event: SessionEvent, protectedProviders: ReadonlySet<string>): SessionEvent {
  if (protectedProviders.size === 0 || !isCatalogEvent(event)) return event
  const message: UserMessage = event.data
  const source = message.source as unknown as CatalogSource
  const protectedNames = new Set(
    source.entries.filter(entry => protectedProviders.has(entry.provider)).map(entry => entry.name),
  )
  if (protectedNames.size === 0) return event
  const entries = source.entries.map(entry => (
    protectedNames.has(entry.name) ? { ...entry, description: WITHHELD_DESCRIPTION } : entry
  ))
  const content = message.content.map(block => (
    block.type === 'text'
      ? { ...block, text: block.text.split('\n').map(line => redactLine(line, protectedNames)).join('\n') }
      : block
  ))
  const redacted: UserMessage = {
    ...message,
    content,
    source: { ...source, entries } as unknown as UserMessage['source'],
  }
  return { ...event, data: redacted }
}
