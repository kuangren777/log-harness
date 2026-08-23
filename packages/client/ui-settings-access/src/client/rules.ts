/**
 * The group rule algebra, restated for the browser so the editor can preview a
 * decision before it saves one.
 *
 * `dsh-auth`'s `rbac.ts` owns these semantics and the Host enforces them; this
 * is a second implementation on purpose, because the preview must answer for
 * rules that exist only in the editor's draft and no wire method decides an
 * unsaved rule set. It deliberately omits the administrator bypass: the
 * question the editor asks is what an ORDINARY member of the group would see.
 */

import type { AdminRuleView } from '@deepseek-ai/dsh-api-remotes/client'

/** The namespace a rule addresses, as the wire spells it. */
export type AccessDomain = AdminRuleView['domain']

/** Every namespace rules may address, in the order the editor lists them. */
export const ACCESS_DOMAINS: readonly AccessDomain[] = ['skill', 'tool', 'model', 'settings-section']

/** The pattern that covers every name in its domain; the editor seeds it to keep a domain open. */
export const CATCH_ALL_PATTERN = '*'

/**
 * Whether one rule pattern covers one name: an exact name, or a prefix ending
 * in `*`. Byte-exact and case-sensitive, matching the Host.
 * @param pattern - exact name, or a prefix ending in `*`.
 * @param name - the name being checked.
 * @returns whether the pattern covers the name.
 */
export function matchesPattern(pattern: string, name: string): boolean {
  if (!pattern.endsWith('*')) return pattern === name
  return name.startsWith(pattern.slice(0, -1))
}

/**
 * Whether any rule addresses one domain, which is what makes it governed.
 * @param rules - the group's rules, in any order.
 * @param domain - the namespace being addressed.
 * @returns whether at least one rule addresses the domain.
 */
export function governsDomain(rules: readonly AdminRuleView[], domain: AccessDomain): boolean {
  return rules.some(rule => rule.domain === domain)
}

/**
 * Decide one name against a governed domain, deny > allow > default-deny.
 * @param rules - the group's rules, in any order.
 * @param domain - the namespace being addressed.
 * @param name - the name being checked.
 * @returns whether the rules grant it.
 */
export function evaluateRules(rules: readonly AdminRuleView[], domain: AccessDomain, name: string): boolean {
  let allowed = false
  for (const rule of rules) {
    if (rule.domain !== domain || !matchesPattern(rule.pattern, name)) continue
    if (rule.effect === 'deny') return false
    allowed = true
  }
  return allowed
}

/**
 * Whether an ordinary member of the group may reach one name — an ungoverned
 * domain grants everything, a governed one is an allowlist.
 * @param rules - the group's rules, in any order.
 * @param domain - the namespace being addressed.
 * @param name - the name being checked.
 * @returns whether a member may reach it.
 */
export function memberPermits(rules: readonly AdminRuleView[], domain: AccessDomain, name: string): boolean {
  if (!governsDomain(rules, domain)) return true
  return evaluateRules(rules, domain, name)
}

/**
 * Suffix that turns an allow pattern into a name inside its language that no
 * administrator would write. Skill names, tool names, `provider/model` routes,
 * and settings namespaces all exclude the space, so a deny matching the probe
 * covers the pattern's whole language rather than one written exception.
 */
const PROBE_SUFFIX = ' probe'

/** A name the pattern covers: the name itself, or its prefix plus the probe. */
function representative(pattern: string): string {
  return pattern.endsWith('*') ? `${pattern.slice(0, -1)}${PROBE_SUFFIX}` : pattern
}

/** How wide one domain's rules leave it for a member of the group. */
export type DomainReach =
  /** No rule addresses the domain: every name in it is granted. */
  | 'open'
  /** A surviving catch-all allow: everything except the written exceptions is granted. */
  | 'open-with-exceptions'
  /** Governed, and only the written allow patterns are granted. */
  | 'allowlist'
  /** Governed, and no name in the domain is granted at all. */
  | 'locked'

/** What one domain's rules do to a member of the group. */
export interface DomainAnalysis {
  /** The namespace analysed. */
  domain: AccessDomain
  /** The rules addressing this domain, in the order the group carries them. */
  rules: readonly AdminRuleView[]
  /** How wide the domain is left. */
  reach: DomainReach
  /** Whether the editor should warn: the domain is governed and not left open-ended. */
  warn: boolean
}

/**
 * Analyse one domain of a rule set, which is what the editor warns from.
 *
 * The first rule addressing a domain turns the whole domain into an allowlist,
 * so a rule set of nothing but denials grants nothing — the footgun this
 * analysis exists to name.
 * @param rules - the group's rules, in any order.
 * @param domain - the namespace being analysed.
 * @returns the domain's rules, its reach, and whether to warn about it.
 */
export function analyzeDomain(rules: readonly AdminRuleView[], domain: AccessDomain): DomainAnalysis {
  const own = rules.filter(rule => rule.domain === domain)
  if (own.length === 0) return { domain, rules: own, reach: 'open', warn: false }
  const admitsSomething = own.some(
    rule => rule.effect === 'allow' && evaluateRules(rules, domain, representative(rule.pattern)),
  )
  if (!admitsSomething) return { domain, rules: own, reach: 'locked', warn: true }
  const openEnded = evaluateRules(rules, domain, `${CATCH_ALL_PATTERN}${PROBE_SUFFIX}`)
  return {
    domain,
    rules: own,
    reach: openEnded ? 'open-with-exceptions' : 'allowlist',
    warn: !openEnded,
  }
}

/**
 * Analyse every domain of a rule set.
 * @param rules - the group's rules, in any order.
 * @returns one analysis per domain, in {@link ACCESS_DOMAINS} order.
 */
export function analyzeRules(rules: readonly AdminRuleView[]): DomainAnalysis[] {
  return ACCESS_DOMAINS.map(domain => analyzeDomain(rules, domain))
}

/** What a member of the group would and would not see of one real catalog. */
export interface NamePreview {
  /** Names the rules grant, in catalog order. */
  visible: readonly string[]
  /** Names the rules refuse, in catalog order. */
  hidden: readonly string[]
}

/**
 * Split one real catalog by what a member of the group may reach.
 * @param rules - the group's rules, draft included.
 * @param domain - the namespace the catalog belongs to.
 * @param names - the catalog, in the order it should render.
 * @returns the granted and refused names.
 */
export function previewNames(
  rules: readonly AdminRuleView[], domain: AccessDomain, names: readonly string[],
): NamePreview {
  const visible: string[] = []
  const hidden: string[] = []
  for (const name of names) (memberPermits(rules, domain, name) ? visible : hidden).push(name)
  return { visible, hidden }
}

/**
 * Whether a rule set already carries one rule, so the editor neither seeds nor
 * appends a duplicate.
 * @param rules - the rules to search.
 * @param candidate - the rule being looked for.
 * @returns whether an identical rule is present.
 */
export function hasRule(rules: readonly AdminRuleView[], candidate: AdminRuleView): boolean {
  return rules.some(
    rule => rule.domain === candidate.domain && rule.pattern === candidate.pattern && rule.effect === candidate.effect,
  )
}

/**
 * Add one rule to a draft, seeding the catch-all allow when this is the first
 * rule the domain has ever carried and it is a denial.
 *
 * Seeding is the whole answer to the footgun: `deny secret-skill` alone denies
 * every skill, while a catch-all allow beside it denies exactly the one name
 * written. The seeded row is an ordinary rule the administrator can delete, so
 * a strict allowlist stays one click away.
 * @param rules - the current draft.
 * @param candidate - the rule being added.
 * @returns the next draft; an unchanged copy when the rule is already there.
 */
export function addRule(rules: readonly AdminRuleView[], candidate: AdminRuleView): AdminRuleView[] {
  if (hasRule(rules, candidate)) return [...rules]
  const seedsCatchAll = candidate.effect === 'deny' && !governsDomain(rules, candidate.domain)
  const catchAll: AdminRuleView = { domain: candidate.domain, pattern: CATCH_ALL_PATTERN, effect: 'allow' }
  return seedsCatchAll ? [...rules, catchAll, candidate] : [...rules, candidate]
}
