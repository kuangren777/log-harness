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
 * The value is fixed for a session because it is a property of the agent preset
 * the session was composed from; changing tiers means the {@link SciTierForkRequest}
 * fork into a session composed from the other preset.
 */
export type SciTier = 'balanced' | 'cluster'

/**
 * Which gate refused a tool call.
 *
 * - `plan` — G1, the cluster tier's declare-before-fan-out latch: no plan was
 *   declared, or the declared plan already authorized an earlier fan-out.
 * - `tier` — G2, the balanced tier's second lock: a fan-out tool reached the
 *   registry in a tier that has no fan-out at all.
 */
export type SciDenialRule = 'plan' | 'tier'

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
     * The tier and preset this session runs at, appended as the session's first
     * `sci/*` event. Every later `sci/*` record is read against it: an audit
     * projection counts a denied fan-out differently depending on the tier that
     * denied it, and `./invariant` asserts that a balanced session never
     * reaches a fan-out tool at all. A reader that skipped this event would
     * therefore attribute the rest of the session to no tier, so it is
     * required-on-read and carries no `ignorable` marker.
     * @param data - the tier and the agent preset carrying it.
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
