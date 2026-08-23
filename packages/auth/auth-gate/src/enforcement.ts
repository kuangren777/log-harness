/**
 * Per-agent enforcement of the `tool` and `model` permission domains.
 *
 * A gateway request carries its principal, so the API surfaces decide their
 * own rows. A running agent carries none: it acts for whoever owns its
 * session, and the two domains it can reach without a request — the tools it
 * may call and the route it may send to — are enforced here, on the agent
 * plane, once per agent.
 * @module @deepseek-ai/dsh-auth-gate/enforcement
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { checkForSessionOwner, type PermissionCheck } from '@deepseek-ai/dsh-auth'

/**
 * The refusal a disallowed model route earns. Named so a composition can tell
 * a policy refusal from an adapter failure, and worded for the account that
 * reads it in the transcript: it names the route it refused and nothing about
 * how the decision was reached.
 */
export class ModelRouteForbidden extends Error {
  /**
   * @param route - the refused `provider/model` route.
   */
  constructor(readonly route: string) {
    super(`model "${route}" is not available for this account`)
    this.name = 'ModelRouteForbidden'
  }
}

/**
 * Install the agent-plane enforcement of both domains.
 *
 * Three listeners, because one cannot do the job:
 *
 * - `agent/session-start` starts the resolution as early as the agent exists,
 *   so the tool restriction is normally in place before anything reads the
 *   registry. The event is `emit`, so nothing awaits this listener.
 * - `agent/pre-step` awaits that same memoized resolution before delegating.
 *   This is the barrier the emit cannot be: a step is the first thing that
 *   turns tool visibility into a prompt, and it is awaited, so the restriction
 *   is installed by the time any listener downstream reads the registry. It is
 *   prepended so it wraps every other pre-step contribution.
 * - `agent/request` re-decides the route the step actually resolved to, after
 *   `next()`, which is where the selection listeners have applied theirs. This
 *   is the operation that makes the routing decision; the picker's refusal in
 *   `session.selectModel` is a better message, not the enforcement.
 *
 * A session with no recorded owner and an owner with no `tool`/`model` rules
 * both keep the unrestricted behavior; see `checkForSessionOwner`.
 * @param ctx - the gate's plugin context, carrying the mounted auth provider.
 */
export function installAgentEnforcement(ctx: Context): void {
  const resolutions = new WeakMap<Agent, Promise<PermissionCheck>>()

  /**
   * The decision for one agent, resolved at most once. Memoizing the PROMISE
   * rather than its value is what makes the emit and the awaited barrier one
   * resolution: the barrier joins the work session-start already started
   * instead of racing a second copy of it.
   */
  function enforcementFor(agent: Agent): Promise<PermissionCheck> {
    const existing = resolutions.get(agent)
    if (existing !== undefined) return existing
    const pending = resolve(agent)
    resolutions.set(agent, pending)
    return pending
  }

  /** Resolve the owner's decision and apply the tool half of it to this agent. */
  async function resolve(agent: Agent): Promise<PermissionCheck> {
    const check = await checkForSessionOwner(ctx.auth, agent.session.id)
    // Read through the AGENT's context, not the gate's: `restrict` files into
    // the calling context's scope, so this is what confines the mask to this
    // agent instead of masking every one of them. `get` rather than the
    // property proxy — the agent's context does not declare `tools` as an
    // injection, and a deployment may mount no tool runtime at all.
    const tools = agent.ctx.get('tools')
    if (tools !== undefined) {
      const names = tools.restrictableNames(agent)
      const allow = names.filter(name => check('tool', name))
      // An untouched allowlist is not registered: an effect that admits
      // everything is indistinguishable from no effect, and every registered
      // restriction has to be intersected on every registry read.
      if (allow.length !== names.length) {
        ctx.effect(() => tools.restrict({ allow }), 'auth-gate: per-owner tool restriction')
      }
    }
    return check
  }

  ctx.on('agent/session-start', ({ agent }) => {
    // Fire-and-forget by the event's contract; `agent/pre-step` below is what
    // guarantees the work finished before it matters. A rejection here would
    // otherwise be an unhandled one — the barrier reports it to the turn that
    // is actually blocked on it.
    void enforcementFor(agent).catch(() => undefined)
  })

  ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    await enforcementFor(agent)
    return next()
  }, true)

  ctx.on('agent/request', async ({ agent }, next): Promise<LlmCallConfig> => {
    const config = await next()
    const route = `${config.provider}/${config.model}`
    if (!(await enforcementFor(agent))('model', route)) throw new ModelRouteForbidden(route)
    return config
  }, true)
}
