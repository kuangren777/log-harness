/**
 * What the galaxy board knows, derived at render from the session snapshot.
 *
 * Turn membership is the Chat Location index's answer, never a guess: a
 * settled `tool-result` node carries no turn of its own, so scanning the flat
 * node list could only infer boundaries. `chat.locations.getTurn(turn)` is
 * the engine's own membership, and `chat.nodes.get(key)` the Node it names.
 *
 * Every number here is either recorded or absent. A call whose paired
 * `tool/call` fell outside the loaded window has no start time, so it reports
 * no elapsed rather than a zero; a provider that reported no usage reports no
 * tokens rather than a zero. The board renders only what it is handed.
 */
import type {
  ChatSnapshot, ConversationSnapshot, ToolCallBlock,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAgentTool } from './tool-names.tsx'

/** One delegated agent call as the board draws it. */
export interface GalaxyAgent {
  /** Tool call identity, stable across running and settled forms. */
  callId: string
  /** The delegated task as the caller described it, or the tool's own noun. */
  label: string
  /** Lifecycle as the badge and the bar read it. */
  status: 'running' | 'done' | 'error'
  /** Wall time in ms — live while running — or null when the start is unknown. */
  elapsedMs: number | null
  /** Provider-reported completion tokens, or null when none were recorded. */
  outputTokens: number | null
}

/** Turn-wide readings shown in the board's header. */
export interface GalaxyTotals {
  /** Turn wall time in ms — live while the turn is open — or null when unrecorded. */
  elapsedMs: number | null
  /** Summed assistant output tokens of the turn, or null when none were recorded. */
  outputTokens: number | null
  /** Whether the turn is still open. */
  running: boolean
}

/** A usage payload the provider may or may not have filled in. */
interface UsageLike {
  outputTokens?: unknown
}

/**
 * Provider-reported completion tokens of one usage payload.
 * @param usage - the node's opaque usage value.
 * @returns the token count, or null when it was not recorded.
 */
function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = (usage as UsageLike).outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Completion tokens a settled call's own result metadata reports.
 *
 * A delegating tool may hand back the child run's usage under `meta.usage`;
 * nothing in the wire contract requires it, so a result without one reports
 * no tokens and the board drops the whole column rather than printing zeros.
 * @param block - the call in either lifecycle form.
 * @returns the token count, or null when the result reports none.
 */
function resultOutputTokens(block: ToolCallBlock): number | null {
  if (!('kind' in block)) return null
  const meta = block.meta
  if (typeof meta !== 'object' || meta === null) return null
  return usageOutputTokens((meta as { usage?: unknown }).usage)
}

/**
 * A Tool root's wire name and arguments, in either lifecycle form.
 * @param block - the call in either lifecycle form.
 * @returns the call head, or null when a window cut left it outside.
 */
function callHead(block: ToolCallBlock): { readonly name: string; readonly argsRaw: string } | null {
  return 'kind' in block ? block.call : { name: block.name, argsRaw: block.argsRaw }
}

/**
 * The task description one delegating call carries.
 *
 * `subagent` names it at the top level (`description`, 3-5 words by its own
 * schema); `workflow` carries an identity block instead, so its name and
 * one-line description live under `meta`. A truncated or malformed argument
 * string names nothing, and the caller falls back to the tool's noun.
 * @param argsRaw - the call's arguments as the model produced them.
 * @returns the description, or undefined when the call names none.
 */
export function agentLabel(argsRaw: string): string | undefined {
  let args: unknown
  try {
    args = JSON.parse(argsRaw)
  } catch {
    return undefined
  }
  if (typeof args !== 'object' || args === null) return undefined
  const record = args as Record<string, unknown>
  const direct = readText(record, 'description')
  if (direct !== undefined) return direct
  const meta = record['meta']
  if (typeof meta !== 'object' || meta === null) return undefined
  const block = meta as Record<string, unknown>
  return readText(block, 'name') ?? readText(block, 'description')
}

/** A non-blank string field of a record, or undefined. */
function readText(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * Wall time of one Tool call: the settled pair's own timestamps, or the live
 * distance from its start while it runs.
 * @param block - the call in either lifecycle form.
 * @param now - the caller's clock reading.
 * @returns elapsed ms, or null when the start time is outside the window.
 */
export function callElapsedMs(block: ToolCallBlock, now: number): number | null {
  if ('kind' in block) {
    return block.callTime === null ? null : Math.max(0, block.time - block.callTime)
  }
  return Math.max(0, now - block.time)
}

/**
 * The delegated agent calls of one turn, in the order the turn dispatched them.
 * @param chat - the session's Chat snapshot.
 * @param turn - the turn the board belongs to.
 * @param now - the caller's clock reading, for still-running calls.
 * @param fallbackLabel - the tool's own noun, used when a call describes nothing.
 * @returns one entry per delegating call; empty when the turn delegated none.
 */
export function agentCalls(
  chat: ChatSnapshot,
  turn: number,
  now: number,
  fallbackLabel: (name: string) => string,
): readonly GalaxyAgent[] {
  const agents: GalaxyAgent[] = []
  for (const key of chat.locations.getTurn(turn)) {
    const node = chat.nodes.get(key)
    if (node === undefined || node.kind !== 'tool-call') continue
    const block = (node.data as { root: ToolCallBlock }).root
    const head = callHead(block)
    if (head === null || !isAgentTool(head.name)) continue
    const settled = 'kind' in block
    agents.push({
      callId: block.callId,
      label: agentLabel(head.argsRaw) ?? fallbackLabel(head.name),
      status: settled ? (block.isError ? 'error' : 'done') : 'running',
      elapsedMs: callElapsedMs(block, now),
      outputTokens: resultOutputTokens(block),
    })
  }
  return agents
}

/**
 * The turn's own header readings.
 * @param snapshot - the session's conversation snapshot.
 * @param turn - the turn the board belongs to.
 * @param now - the caller's clock reading, for a turn still open.
 * @returns the turn's elapsed time, output tokens, and open state.
 */
export function turnTotals(snapshot: ConversationSnapshot, turn: number, now: number): GalaxyTotals {
  const timing = snapshot.turnTimings.get(turn)
  const running = timing !== undefined && timing.endTime === undefined
  const elapsedMs = timing === undefined
    ? null
    : Math.max(0, (timing.endTime ?? now) - timing.startTime)
  let outputTokens: number | null = null
  for (const node of snapshot.nodes) {
    if (node.kind !== 'assistant' || node.turn !== turn) continue
    const tokens = usageOutputTokens(node.usage)
    if (tokens === null) continue
    outputTokens = (outputTokens ?? 0) + tokens
  }
  return { elapsedMs, outputTokens, running }
}
