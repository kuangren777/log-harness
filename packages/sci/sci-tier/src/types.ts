/**
 * Durable vocabulary of the tier layer: the two tiers a science-research
 * session runs at, the rule names the two fan-out gates deny under, and the
 * three session events this package appends.
 * @module @deepseek-ai/dsh-sci-tier/types
 */

/**
 * How much machinery one session is allowed to spend.
 *
 * - `balanced` — the ordinary single-threaded pass. No fan-out tool is mounted,
 *   and `ctx.tools.guard()` denies one that reaches the registry anyway.
 * - `cluster` — research-grade depth. Fan-out is available, but each fan-out
 *   costs one `declare_research_plan` declaration.
 *
 * In the `balanced` and `cluster` compositions the value is fixed for a session,
 * because it is a property of the agent preset the session was composed from;
 * changing tiers means the {@link SciTierForkRequest} fork into a session
 * composed from the other preset. In the `auto` composition
 * ({@link SciTierMode}) the value is resolved by the model per task and may be
 * raised from `balanced` to `cluster` mid-session.
 */
export type SciTier = 'balanced' | 'cluster'

/**
 * What a composition is configured at: one of the two tiers, fixed, or `auto`,
 * where the composition mounts the cluster tools and the model resolves the
 * tier from the task by calling `resolve_tier` before its first fan-out.
 *
 * `auto` exists because the studied platform bound the tier before the task was
 * known: a user picking the single-threaded tier for a task that turned out to
 * need a real experiment left the model no honest path, and it delivered a
 * hollow result (`clawsgo-analysis/CLAWSGO-SCHEDULING.md` §1.2, §6.1).
 */
export type SciTierMode = SciTier | 'auto'

/** Who resolved a session's tier. */
export type SciTierResolver = 'composition' | 'model'

/**
 * Which gate refused a tool call.
 *
 * - `plan` — G1, the cluster tier's declare-before-fan-out latch: no plan was
 *   declared, or the declared plan already authorized an earlier fan-out.
 * - `tier` — G2, the balanced tier's second lock: a fan-out tool reached the
 *   registry in a session whose tier has no fan-out at all — the balanced
 *   composition, or an auto session the model resolved to `balanced`.
 * - `unresolved` — G0, the auto composition's first lock: a fan-out was called
 *   before the model resolved the session's tier with `resolve_tier`.
 */
export type SciDenialRule = 'plan' | 'tier' | 'unresolved'

/** Payload of {@link SessionEventMap['sci/tier-resolved']}. */
export interface SciTierResolvedData {
  /** The tier this session runs at, from the mounted plugin's own configuration. */
  readonly tier: SciTier
  /**
   * Agent preset the session was composed from — the durable name of the
   * composition that carries the tier. The resolved model is not repeated here:
   * `request/context` already records the route each request actually took, and
   * the lineage of an upgrade fork is already in the session header.
   */
  readonly presetName: string
  /**
   * Who resolved the tier. Absent when the composition's preset fixed it, which
   * is the balanced and cluster compositions' only case; `model` when the auto
   * composition's `resolve_tier` call resolved or raised it.
   */
  readonly resolvedBy?: SciTierResolver
  /** The model's one-sentence account of why the task needs this tier; present with `resolvedBy: 'model'` only. */
  readonly reason?: string
}

/** Payload of {@link SessionEventMap['sci/tier-upgrade-suggested']}. */
export interface SciTierUpgradeSuggestedData {
  /** The model's one-sentence account of what the cluster tier would add, as it wrote it. */
  readonly reason: string
}

/** Payload of {@link SessionEventMap['sci/tool-denied']}. */
export interface SciToolDeniedData {
  /** Registered name of the tool call that was refused. */
  readonly toolName: string
  /** Which of the two gates refused it. */
  readonly rule: SciDenialRule
  /** The refusal text the model received as its tool result. */
  readonly reason: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The tier and preset this session runs at. In the balanced and cluster
     * compositions it is appended as the session's first `sci/*` event; in the
     * auto composition it is appended by `resolve_tier`, once when the model
     * resolves the task and again if it raises the tier, and the LAST record
     * is the session's tier. Every later `sci/*` record is read against it: an
     * audit projection counts a denied fan-out differently depending on the
     * tier that denied it, and `./invariant` asserts that a session whose
     * latest tier is balanced never reaches a fan-out tool at all. A reader
     * that skipped this event would therefore attribute the rest of the
     * session to no tier, so it is required-on-read and carries no
     * `ignorable` marker.
     * @param data - the tier, the agent preset carrying it, and for a
     *   model-resolved tier who resolved it and why.
     */
    'sci/tier-resolved': SciTierResolvedData
    /**
     * The model asked, from a balanced session, that the work continue in the
     * cluster tier. Log-only, non-surface, and appended with the envelope's
     * `ignorable` marker: the model already knows it made the suggestion, and
     * the record exists so a user interface can offer the upgrade fork and so
     * the fork can quote the reason into the new session's opening message.
     * @param data - the model's one-sentence account of what the cluster would add.
     */
    'sci/tier-upgrade-suggested': SciTierUpgradeSuggestedData
    /**
     * One tool call was refused by a tier gate. Log-only, non-surface, and
     * appended with the envelope's `ignorable` marker: the refusal reached the
     * model as the tool result, and nothing later in the log is interpreted
     * differently by this event's presence — it exists so an audit projection
     * can count refusals per rule.
     * @param data - the refused tool's name, the gate that refused it, and the refusal text.
     */
    'sci/tool-denied': SciToolDeniedData
  }
}
