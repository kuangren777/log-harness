/**
 * skills domain contract: read-only skill catalog and inventory lookup
 * addressed by session. The session's header cwd resolves to the canonical
 * project root host-side — the client never submits a raw path, and skill
 * lookup never creates or resumes an Agent.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AuthorizedRequest, RpcResponse } from './rpc.ts'

/** Skill catalog row (wire projection of the host SkillSummary; provider/source vocabulary stays host-side). */
export interface SkillEntry {
  /** Kebab-case identifier the user references as `/name` in the composer. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** False marks a user-only skill (`disable-model-invocation`): invocable here, absent from the model catalog. */
  readonly modelInvocable: boolean
}

/** Both invocation surfaces of one skill (wire projection of the host SkillInvocationPolicy). */
export interface SkillInvocationSurfaces {
  /** Whether model-facing catalogs and loaders include the skill. */
  readonly modelInvocable: boolean
  /** Whether user-facing command catalogs and loaders include the skill. */
  readonly userInvocable: boolean
}

/**
 * The user's stored override of one skill's authored policy (wire projection
 * of the host SkillPolicyOverride). An absent field keeps what the skill
 * declared; a present field replaces it outright.
 */
export interface SkillPolicyOverrideView {
  /** Replacement for {@link SkillInvocationSurfaces.modelInvocable}. */
  readonly model?: boolean
  /** Replacement for {@link SkillInvocationSurfaces.userInvocable}. */
  readonly user?: boolean
}

/**
 * One discovered skill as the inventory reports it, winner or shadowed loser
 * (wire projection of the host SkillInventoryEntry).
 */
export interface SkillInventoryEntry {
  /** Kebab-case identifier used to address the skill. */
  readonly name: string
  /** Short routing description as the contribution declared it. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Absolute file path when the provider has one; a provider without files omits it. */
  readonly path?: string
  /** Policy the contribution itself declared. */
  readonly authored: SkillInvocationSurfaces
  /** Policy consumers enforce, after the user override. */
  readonly effective: SkillInvocationSurfaces
  /** The stored override that produced `effective`, when one exists for this name. */
  readonly override?: SkillPolicyOverrideView
  /** Whether a nearer layer or a better rank already claimed this name. */
  readonly shadowed: boolean
}

/**
 * Discovered skills sharing one origin (wire projection of the host
 * SkillInventoryGroup). `source` is the host's open origin vocabulary, so
 * clients render an unrecognized value rather than switching on it.
 */
export interface SkillInventoryGroup {
  /** Origin bucket shared by every entry in this group. */
  readonly source: string
  /** Precedence rank shared by every entry in this group. */
  readonly rank: number
  /** Absolute directory the group was discovered in, when the provider scans directories. */
  readonly root?: string
  /** Whether the group came from the host-wide layer or the viewing scope's chain. */
  readonly layer: 'global' | 'scope'
  /** Entries in discovery order within this origin. */
  readonly skills: readonly SkillInventoryEntry[]
}

/**
 * Every discovered skill including the shadowed losers the catalog hides
 * (wire projection of the host SkillInventory).
 */
export interface SkillInventory {
  /** Origin groups, nearest layer first and best rank first. */
  readonly groups: readonly SkillInventoryGroup[]
  /** False when a provider failed or the catalog moved mid-discovery, so the view is partial. */
  readonly complete: boolean
}

/**
 * Skill-domain unary methods (the map key skill.* of RpcMethodMap). Both
 * methods only read: invocation itself is a plain `session.prompt` whose
 * leading `/name` token the host recognizes at the pre-step boundary
 * (`dsh-tool-skill` injects the rendered body there), so every client shares
 * one deterministic path with no dedicated invocation wire.
 */
export interface SkillsApi {
  /**
   * Lists the user-invocable skill catalog for the session's project, as the
   * request's principal may see it: a skill the `skill` domain's permission
   * rules refuse that account is absent, not merely uninvocable.
   */
  list(request: AuthorizedRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ skills: readonly SkillEntry[] }>>
  /**
   * Reports every skill the session's project discovers, grouped by origin
   * and including shadowed losers, with each entry's authored policy, its
   * effective policy, and the override between them. `list` answers what the
   * composer may invoke; this answers what exists and why it is not winning,
   * which is what a policy editor needs to offer a toggle.
   *
   * Permission rules OMIT a refused entry here rather than marking it. The
   * inventory is the product's richest disclosure of a skill — its
   * description, its origin, and its absolute path — so a marked row would
   * hand a refused account everything except the content. Groups survive an
   * emptied entry list: the origin roster and `complete` describe what the
   * project discovered, which does not change with who is asking.
   */
  inventory(request: AuthorizedRequest<{ sessionId: SessionId }>): Promise<RpcResponse<SkillInventory>>
}
