/**
 * The tier layer of the science-research agent profile: which tier a session
 * runs at, the prompt section that says so, and the gates that make it true
 * rather than advisory.
 *
 * `apply` owns these contributions, all effects of the mounting fiber:
 *
 * - The tier prompt section — the balanced, cluster, or auto text, selected by
 *   {@link Config.tier}.
 * - **G1**, the declare-before-fan-out gate of the cluster and auto
 *   compositions: one `tools/pre-execute` listener over
 *   {@link Config.fanoutTools} that spends a per-session latch. The latch is
 *   written by `sci/plan-declared` from `@deepseek-ai/dsh-sci-plan` and rebuilt
 *   from the log after a restart.
 * - **G2**, the balanced tier's second lock: `ctx.tools.guard()` denying every
 *   fan-out name, plus a load-time refusal when one is already in the catalog.
 * - **G0**, the auto composition's resolution lock: the same `tools/pre-execute`
 *   listener and a `ctx.tools.guard()` both deny every fan-out until the
 *   session's latest `sci/tier-resolved` — written by `./resolve` — says
 *   `cluster`. A session the model resolved to `balanced` is refused with the
 *   raise as its exit; an unresolved one with the resolution as its exit.
 *
 * `ctx.tools.restrict()` cannot serve as G2: it validates every name against the
 * mounted catalog and throws on one the preset never mounted
 * (`packages/core/tools/src/index.ts:1088`), which is exactly the case the
 * balanced tier is in. `guard()` is deny-only and name-blind, so it survives the
 * composition it is protecting.
 *
 * The tool the balanced tier offers instead of fanning out, and the RPC that
 * acts on it, are separate mountable modules: `./suggest` (agent plane, balanced
 * only) and `./fork` (host plane).
 *
 * Named exports (no default) preserve the Loader's `name`/`inject`/`Config`
 * injection metadata for a function plugin.
 * @module @deepseek-ai/dsh-sci-tier
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CallId } from '@deepseek-ai/dsh-llm'
import { PLAN_TOOL } from '@deepseek-ai/dsh-sci-plan'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
// Type-only: merges the services this plugin injects onto Context, and the
// declaration event the latch is written from.
import type {} from '@deepseek-ai/dsh-sci-plan'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { TIER_SECTION_ORDER, TIER_SECTIONS } from './chapter.ts'
import { Config } from './config.ts'
import type { FanoutLatch } from './latch.ts'
import {
  denyBalanced,
  denyConsumed,
  denyResolvedBalanced,
  denyUndeclared,
  denyUnresolved,
  rebuildLatch,
  rebuildResolvedTier,
} from './latch.ts'
import { PRESET_NAMES } from './presets.ts'
import type { SciDenialRule, SciTier } from './types.ts'

export {
  CHAPTER_TIER_AUTO,
  CHAPTER_TIER_BALANCED,
  CHAPTER_TIER_CLUSTER,
  SECTION_TIER_AUTO,
  SECTION_TIER_BALANCED,
  SECTION_TIER_CLUSTER,
  TIER_SECTIONS,
  TIER_SECTION_ORDER,
} from './chapter.ts'
export {
  DEFAULT_FANOUT_TOOLS,
  PERSONA_FANOUT_TOOLS,
  SUBAGENT_TOOL_PREFIX,
  subagentToolName,
} from './config.ts'
export {
  FORK_NAMESPACE,
  SERVICE_KEY,
  SciTierForkService,
  composeForkOpening,
} from './fork.ts'
export type {
  SciTierForkError,
  SciTierForkRequest,
  SciTierForkResult,
  SciTierForkValue,
} from './fork.ts'
export {
  denyBalanced,
  denyConsumed,
  denyResolvedBalanced,
  denyUndeclared,
  denyUnresolved,
  rebuildLatch,
  rebuildResolvedTier,
} from './latch.ts'
export type { FanoutLatch } from './latch.ts'
export { PRESET_NAMES } from './presets.ts'
export { RESOLVABLE_TIERS, RESOLVE_TOOL, describeResolveTool, formatResolveResult } from './resolve-tool.ts'
export { SUGGEST_TOOL, describeSuggestTool } from './suggest-tool.ts'
export type {
  SciDenialRule,
  SciTier,
  SciTierMode,
  SciTierResolvedData,
  SciTierResolver,
  SciTierUpgradeSuggestedData,
  SciToolDeniedData,
} from './types.ts'
export { Config }

/** Cordis plugin name. */
export const name = 'sci-tier'

/** The tool registry both gates sit in, and the prompt layer the tier section joins. */
export const inject = ['tools', 'systemPrompt']

/**
 * Register the science-research tier layer on the mounting context.
 * @param ctx - the mounting context, carrying `tools` and `systemPrompt`.
 * @param config - the resolved deployment configuration.
 * @throws Error when the balanced tier's catalog already carries a fan-out tool,
 *   which is a composition that states one tier and can execute another.
 */
export function apply(ctx: Context, config: Config): void {
  const fanoutTools = new Set(config.fanoutTools)
  const balanced = config.tier === 'balanced'
  if (balanced) {
    const alreadyMounted = config.fanoutTools.filter(toolName => ctx.tools.get(toolName) !== undefined)
    if (alreadyMounted.length > 0) {
      throw new Error(
        `sci-tier: the balanced tier mounts no fan-out tools, but ${alreadyMounted.map(toolName => JSON.stringify(toolName)).join(', ')} `
        + 'is already in this catalog. Remove the tool from the preset, or compose the session at tier "cluster".',
      )
    }
  }

  const section = TIER_SECTIONS[config.tier]
  ctx.systemPrompt.section({ name: section.name, order: TIER_SECTION_ORDER, text: section.text })

  // In the fixed compositions the tier is a fact about the whole session, so it
  // is recorded at the one moment the session exists and has no events yet. A
  // session restored from storage already carries the record its first
  // lifecycle wrote. The auto composition records nothing here: its record is
  // the model's own `resolve_tier` call.
  if (config.tier !== 'auto') {
    const tier: SciTier = config.tier
    ctx.on('session/created', (session: Session) => {
      if (session.events.some(event => event.type === 'sci/tier-resolved')) return
      session.append('sci/tier-resolved', {
        tier,
        presetName: session.header.agentPreset ?? PRESET_NAMES[tier],
      })
    })
  }

  /**
   * Record one gate's refusal on the session that was refused.
   * @param session - the session the refused call belonged to, if any.
   * @param toolName - the refused tool.
   * @param rule - which gate refused it.
   * @param reason - the refusal text the model receives.
   * @returns the same reason, so a caller can record and answer in one expression.
   */
  const refuse = (session: Session | undefined, toolName: string, rule: SciDenialRule, reason: string): string => {
    session?.append('sci/tool-denied', { toolName, rule, reason }, { ignorable: true })
    return reason
  }

  if (balanced) {
    // Registered after the extensible `tools/pre-execute` waterfall and unable
    // to be force-allowed by it: a later listener answering `allow` still meets
    // this guard, which is what makes the tier a property of the composition
    // rather than of listener order.
    ctx.tools.guard((exec): string | undefined => {
      if (!fanoutTools.has(exec.name)) return undefined
      return refuse(exec.agent?.session, exec.name, 'tier', denyBalanced(exec.name))
    })
    return
  }

  const auto = config.tier === 'auto'
  // The resolved tier of each auto session, recovered from the log on first use
  // and kept current by the `sci/tier-resolved` records `./resolve` appends.
  const resolvedTiers = new Map<SessionId, SciTier>()
  const resolvedInitialised = new Set<SessionId>()

  /**
   * The tier one auto session is currently resolved to.
   * @param session - the session whose fan-out is being decided.
   * @returns the latest resolved tier, or `undefined` before the first resolution.
   */
  const resolvedTierOf = (session: Session): SciTier | undefined => {
    if (!resolvedInitialised.has(session.id)) {
      resolvedInitialised.add(session.id)
      const rebuilt = rebuildResolvedTier(session.events)
      if (rebuilt !== undefined) resolvedTiers.set(session.id, rebuilt)
    }
    return resolvedTiers.get(session.id)
  }

  /**
   * G0: why one auto session's fan-out is shut before the latch is consulted.
   * @param session - the session the call belongs to, if any.
   * @param toolName - the fan-out tool that was called.
   * @returns the rule and refusal text, or `undefined` when the session is resolved to cluster.
   */
  const closedFor = (session: Session | undefined, toolName: string): { rule: SciDenialRule; reason: string } | undefined => {
    if (!auto) return undefined
    const tier = session === undefined ? undefined : resolvedTierOf(session)
    if (tier === 'cluster') return undefined
    if (tier === 'balanced') return { rule: 'tier', reason: denyResolvedBalanced(toolName) }
    return { rule: 'unresolved', reason: denyUnresolved(toolName) }
  }

  if (auto) {
    // G0 is also a guard, for the same reason G2 is: a later `tools/pre-execute`
    // listener answering `allow` must still meet the resolution lock.
    ctx.tools.guard((exec): string | undefined => {
      if (!fanoutTools.has(exec.name) || exec.name === PLAN_TOOL) return undefined
      const closed = closedFor(exec.agent?.session, exec.name)
      return closed === undefined ? undefined : refuse(exec.agent?.session, exec.name, closed.rule, closed.reason)
    })
  }

  // The authoritative latches of this process, one per session. `initialised`
  // records that a session's latch has been recovered from its log, so a
  // consumed latch is not silently replaced by a rebuild of the same log.
  const latches = new Map<SessionId, FanoutLatch>()
  const initialised = new Set<SessionId>()

  /**
   * The live latch of one session, recovering it from the log on first use.
   * @param session - the session whose fan-out is being decided.
   * @param inFlightCallId - the call being decided, excluded from the rebuild.
   * @returns the latch, or `undefined` when no plan was declared.
   */
  const latchOf = (session: Session, inFlightCallId: CallId): FanoutLatch | undefined => {
    if (!initialised.has(session.id)) {
      initialised.add(session.id)
      const rebuilt = rebuildLatch(session.events, fanoutTools, inFlightCallId)
      if (rebuilt !== undefined) latches.set(session.id, rebuilt)
    }
    return latches.get(session.id)
  }

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type === 'sci/tier-resolved') {
      resolvedInitialised.add(session.id)
      resolvedTiers.set(session.id, event.data.tier)
      return
    }
    if (event.type !== 'sci/plan-declared') return
    initialised.add(session.id)
    latches.set(session.id, { planId: event.data.planId, consumed: false })
  })

  ctx.on('tools/pre-execute', (exec, next): Promise<PreToolDecision> => {
    // A declaration is what the gate spends, so it can never be what the gate
    // refuses, even in a deployment that lists it among the fan-out names.
    if (!fanoutTools.has(exec.name) || exec.name === PLAN_TOOL) return next()
    const session = exec.agent?.session
    const closed = closedFor(session, exec.name)
    if (closed !== undefined) {
      return Promise.resolve({ kind: 'deny', reason: refuse(session, exec.name, closed.rule, closed.reason) })
    }
    const latch = session === undefined ? undefined : latchOf(session, exec.callId)
    if (latch === undefined) {
      return Promise.resolve({ kind: 'deny', reason: refuse(session, exec.name, 'plan', denyUndeclared(exec.name)) })
    }
    if (latch.consumed) {
      return Promise.resolve({ kind: 'deny', reason: refuse(session, exec.name, 'plan', denyConsumed(exec.name)) })
    }
    // Consumed here, before delegating, so two calls dispatched from one
    // assistant message cannot both read an unspent latch.
    latch.consumed = true
    return next()
  })
}
