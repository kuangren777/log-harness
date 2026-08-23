/**
 * Rule evaluation: a pure function of the rules a principal's groups carry.
 * Nothing here reads storage, so a Consumer can decide a permission inside a
 * hot path once it holds the rule list.
 * @module @deepseek-ai/dsh-auth/rbac
 */

import type { PermissionDomain, PermissionRule, Principal } from './types.ts'

/**
 * Whether one rule pattern covers one name.
 *
 * A pattern is either an exact name or a prefix ending in `*`. `*` is special
 * only as the final character: `web_*` covers `web_search` and `web_` itself;
 * `web*search` covers nothing but the literal name `web*search`; a bare `*`
 * covers every name in its domain, including the empty one. Matching is
 * case-sensitive and byte-exact, because every domain it addresses — skill
 * names, tool names, `provider/model` routes, settings namespaces — is
 * case-sensitive at its own registry.
 *
 * The `model` domain's names are the full `provider/model` route, so
 * `deepseek/*` covers one provider's models and `deepseek/deepseek-chat`
 * covers one model. There is no separator-aware wildcard: `*` spans `/` like
 * any other character.
 * @param pattern - exact name, or a prefix ending in `*`.
 * @param name - the name being checked.
 * @returns whether the pattern covers the name.
 */
export function matchesPattern(pattern: string, name: string): boolean {
  if (!pattern.endsWith('*')) return pattern === name
  return name.startsWith(pattern.slice(0, -1))
}

/**
 * Decide one name against a rule set, with precedence deny > allow > default-deny.
 *
 * Every matching rule is considered, not just the most specific one: a single
 * `deny` refuses regardless of how many `allow` rules also match, and how
 * broad each pattern is never enters the decision. That ordering is what makes
 * a deny rule a reliable revocation — adding a group cannot widen access past
 * a deny another group already carries. With no matching rule at all the
 * answer is `false`, so a name nobody wrote a rule for is refused rather than
 * silently permitted.
 * @param rules - every rule the principal's groups carry, in any order.
 * @param domain - the namespace being addressed; rules in other domains are ignored.
 * @param name - the name being checked.
 * @returns whether access is granted.
 */
export function evaluate(
  rules: readonly PermissionRule[],
  domain: PermissionDomain,
  name: string,
): boolean {
  let allowed = false
  for (const rule of rules) {
    if (rule.domain !== domain || !matchesPattern(rule.pattern, name)) continue
    if (rule.effect === 'deny') return false
    allowed = true
  }
  return allowed
}

/**
 * Whether any rule the principal's groups carry addresses one domain, which is
 * what makes that domain governed for them.
 *
 * Governance is per domain and opt-in, and this predicate is the switch. It
 * reads the same rule list {@link evaluate} does, so the two cannot disagree
 * about which rules are in scope.
 * @param rules - every rule the principal's groups carry, in any order.
 * @param domain - the namespace being addressed.
 * @returns whether at least one rule addresses the domain.
 */
export function governs(rules: readonly PermissionRule[], domain: PermissionDomain): boolean {
  return rules.some(rule => rule.domain === domain)
}

/**
 * Decide one name for one principal — the entry point a Consumer calls.
 *
 * Two principals bypass {@link evaluate} entirely: `local`, which is the
 * single-tenant in-process principal and holds full rights, and an `admin`
 * user, whose administrator membership grants everything. The bypass lives
 * here rather than inside `evaluate` so the rule algebra stays a pure function
 * of rules, and so a caller that genuinely wants the unbypassed answer — an
 * administration UI previewing what a group grants — can ask `evaluate`
 * directly.
 *
 * A deny rule therefore cannot lock an administrator out. That is deliberate:
 * an administrator can edit the rules, so a lockout would only be a slower
 * path back to the same access.
 *
 * A domain no rule addresses is UNGOVERNED and grants everything in it. Only
 * {@link evaluate}'s default-deny is bypassed, and only for a domain the
 * administrator has said nothing about: once one rule names the domain, every
 * name in it is decided by the rules alone, so an allowlist is still an
 * allowlist. Without this step an account would have to be granted every skill,
 * tool, model route, and settings namespace it uses before a group could
 * revoke a single one, and a freshly created group — which carries no rules —
 * would take the whole product away from its members instead of nothing.
 * @param principal - the acting principal.
 * @param rules - every rule the principal's groups carry; ignored for a bypassing principal.
 * @param domain - the namespace being addressed.
 * @param name - the name being checked.
 * @returns whether access is granted.
 */
export function permits(
  principal: Principal,
  rules: readonly PermissionRule[],
  domain: PermissionDomain,
  name: string,
): boolean {
  if (principal.kind === 'local' || principal.admin) return true
  if (!governs(rules, domain)) return true
  return evaluate(rules, domain, name)
}
