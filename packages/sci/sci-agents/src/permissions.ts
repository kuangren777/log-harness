/**
 * The mapping between the three permission switches a person sees and the
 * `toolFilter.deny` list that actually enforces them.
 *
 * The switches are not stored: `toolFilter.deny` is, because that is the list
 * `@deepseek-ai/dsh-tool-subagent` sends with every start request and
 * `ctx.tools.restrict()` applies at child creation. A stored switch would be a
 * second truth that a composition-level denial could silently contradict.
 * Everything here is pure; the tool names come from the deployment's config
 * because tool registration is a composition choice.
 * @module @deepseek-ai/dsh-sci-agents/src/permissions
 */

import type { AgentPermissions } from './types.ts'

/** The registered tool names each switch governs, in switch order. */
export interface PermissionTools {
  /** Tools the `web` switch withholds. */
  readonly web: readonly string[]
  /** Tools the `code` switch withholds. */
  readonly code: readonly string[]
  /** Tools the `writeLibrary` switch withholds. */
  readonly writeLibrary: readonly string[]
}

/** The three switches, in the order the configuration page draws them. */
export const PERMISSION_KEYS = ['web', 'code', 'writeLibrary'] as const

/** One switch's key. */
export type PermissionKey = typeof PERMISSION_KEYS[number]

/**
 * Read the three switches out of a resolved deny list.
 *
 * A switch reads `false` as soon as ANY tool of its group is denied, not only
 * when all of them are: a child that lost `web_search` but kept `web_fetch`
 * does not have the web permission, and reporting it as granted would describe
 * a capability the child does not have. The consequence is deliberate and
 * documented — a group the COMPOSITION denies in part reads off and stays off,
 * because the entry's denials are a floor the settings layer cannot lift.
 * @param deny - the delegation tool's resolved `toolFilter.deny`, if any.
 * @param tools - the deployment's tool names for the three groups.
 * @returns the three switches as the roster reports them.
 */
export function readPermissions(
  deny: readonly string[] | undefined,
  tools: PermissionTools,
): AgentPermissions {
  const denied = new Set(deny ?? [])
  return {
    web: !tools.web.some(name => denied.has(name)),
    code: !tools.code.some(name => denied.has(name)),
    writeLibrary: !tools.writeLibrary.some(name => denied.has(name)),
  }
}

/**
 * Rewrite a stored deny list so it expresses the requested switches.
 *
 * Only the names this mapping owns are touched: a denial naming a tool outside
 * the three groups was written by something else (a composition entry projected
 * into the settings base, or a deployment's own document) and survives the
 * write untouched. Names are emitted in group order so a stored document does
 * not churn when nothing changed.
 * @param stored - the user layer's current deny list, if any.
 * @param permissions - the switches the gesture asks for.
 * @param tools - the deployment's tool names for the three groups.
 * @returns the next deny list, or `undefined` when it would be empty.
 */
export function writePermissions(
  stored: readonly string[] | undefined,
  permissions: AgentPermissions,
  tools: PermissionTools,
): readonly string[] | undefined {
  const owned = new Set(PERMISSION_KEYS.flatMap(key => [...tools[key]]))
  const kept = (stored ?? []).filter(name => !owned.has(name))
  const added = PERMISSION_KEYS.flatMap(key => permissions[key] ? [] : [...tools[key]])
  const next = [...new Set([...kept, ...added])]
  return next.length === 0 ? undefined : next
}
