/**
 * The rule algebra the editor previews from: pattern matching, the
 * deny > allow > default-deny decision, per-domain reach, the probe that
 * reports which rule decided a name, and the catch-all seeding that keeps
 * "block one thing" from meaning "block everything".
 */
import { describe, expect, it } from 'vitest'
import type { AdminRuleView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  ACCESS_DOMAINS, addRule, analyzeDomain, analyzeRules, CATCH_ALL_PATTERN, evaluateRules,
  governsDomain, hasRule, matchesPattern, memberPermits, previewNames, probeName,
} from '../src/client/rules.ts'

const allow = (pattern: string, domain: AdminRuleView['domain'] = 'skill'): AdminRuleView =>
  ({ domain, pattern, effect: 'allow' })
const deny = (pattern: string, domain: AdminRuleView['domain'] = 'skill'): AdminRuleView =>
  ({ domain, pattern, effect: 'deny' })

describe('matchesPattern', () => {
  it('matches an exact name exactly', () => {
    expect(matchesPattern('web_search', 'web_search')).toBe(true)
    expect(matchesPattern('web_search', 'web_searching')).toBe(false)
  })

  it('treats a trailing star as a prefix and nothing else as special', () => {
    expect(matchesPattern('web_*', 'web_search')).toBe(true)
    expect(matchesPattern('web_*', 'web_')).toBe(true)
    expect(matchesPattern('web_*', 'search')).toBe(false)
    expect(matchesPattern('web*search', 'web_search')).toBe(false)
    expect(matchesPattern(CATCH_ALL_PATTERN, '')).toBe(true)
  })
})

describe('evaluateRules', () => {
  it('lets one deny beat every allow, however broad', () => {
    expect(evaluateRules([allow(CATCH_ALL_PATTERN), deny('secret')], 'skill', 'secret')).toBe(false)
    expect(evaluateRules([deny('secret'), allow('secret')], 'skill', 'secret')).toBe(false)
  })

  it('refuses a name no rule matches, and ignores other domains', () => {
    expect(evaluateRules([allow('alpha')], 'skill', 'beta')).toBe(false)
    expect(evaluateRules([allow(CATCH_ALL_PATTERN, 'tool')], 'skill', 'alpha')).toBe(false)
  })
})

describe('governsDomain and memberPermits', () => {
  it('grants everything in a domain no rule addresses', () => {
    expect(governsDomain([allow('alpha', 'tool')], 'skill')).toBe(false)
    expect(memberPermits([allow('alpha', 'tool')], 'skill', 'anything')).toBe(true)
  })

  it('turns the domain into an allowlist from its first rule', () => {
    expect(governsDomain([deny('secret')], 'skill')).toBe(true)
    expect(memberPermits([deny('secret')], 'skill', 'anything')).toBe(false)
  })
})

describe('analyzeDomain', () => {
  it('reports an ungoverned domain as open, with nothing to warn about', () => {
    expect(analyzeDomain([], 'skill')).toEqual({ domain: 'skill', rules: [], reach: 'open', warn: false })
  })

  it('reports a deny-only domain as locked and warns', () => {
    const analysis = analyzeDomain([deny('secret')], 'skill')
    expect(analysis.reach).toBe('locked')
    expect(analysis.warn).toBe(true)
  })

  it('reports a domain whose every allow is cancelled by a deny as locked', () => {
    expect(analyzeDomain([allow('web_*'), deny('web_*')], 'skill').reach).toBe('locked')
    expect(analyzeDomain([allow('alpha'), deny(CATCH_ALL_PATTERN)], 'skill').reach).toBe('locked')
  })

  it('reports explicit allows without a catch-all as an allowlist and warns', () => {
    const analysis = analyzeDomain([allow('alpha'), allow('beta')], 'skill')
    expect(analysis.reach).toBe('allowlist')
    expect(analysis.warn).toBe(true)
    expect(analysis.rules).toHaveLength(2)
  })

  it('stops warning once a surviving catch-all allow keeps the domain open-ended', () => {
    const analysis = analyzeDomain([allow(CATCH_ALL_PATTERN), deny('secret')], 'skill')
    expect(analysis.reach).toBe('open-with-exceptions')
    expect(analysis.warn).toBe(false)
  })

  it('keeps a prefix allow open-ended within its prefix but still an allowlist overall', () => {
    expect(analyzeDomain([allow('web_*'), deny('web_search')], 'skill').reach).toBe('allowlist')
  })

  it('reads only its own domain', () => {
    expect(analyzeDomain([deny('secret', 'tool')], 'skill').reach).toBe('open')
  })
})

describe('analyzeRules', () => {
  it('answers for every domain in the editor order', () => {
    const analyses = analyzeRules([deny('secret'), allow(CATCH_ALL_PATTERN, 'model')])
    expect(analyses.map(analysis => analysis.domain)).toEqual([...ACCESS_DOMAINS])
    expect(analyses.map(analysis => analysis.reach)).toEqual([
      'locked', 'open', 'open-with-exceptions', 'open',
    ])
  })
})

describe('previewNames', () => {
  it('splits a catalog by what a member may reach', () => {
    expect(previewNames([allow(CATCH_ALL_PATTERN), deny('secret')], 'skill', ['alpha', 'secret'])).toEqual({
      visible: ['alpha'], hidden: ['secret'],
    })
  })

  it('shows the whole catalog when the domain is ungoverned', () => {
    expect(previewNames([], 'skill', ['alpha', 'secret'])).toEqual({ visible: ['alpha', 'secret'], hidden: [] })
  })

  it('hides the whole catalog behind a deny-only rule set', () => {
    expect(previewNames([deny('secret')], 'skill', ['alpha', 'secret'])).toEqual({
      visible: [], hidden: ['alpha', 'secret'],
    })
  })
})

describe('hasRule and addRule', () => {
  it('recognizes an identical rule and adds nothing for it', () => {
    const rules = [allow('alpha')]
    expect(hasRule(rules, allow('alpha'))).toBe(true)
    expect(hasRule(rules, deny('alpha'))).toBe(false)
    expect(addRule(rules, allow('alpha'))).toEqual(rules)
  })

  it('seeds a catch-all allow beside a domain’s first denial', () => {
    expect(addRule([], deny('secret'))).toEqual([allow(CATCH_ALL_PATTERN), deny('secret')])
  })

  it('seeds nothing for a first allow, or for a denial in an already governed domain', () => {
    expect(addRule([], allow('alpha'))).toEqual([allow('alpha')])
    expect(addRule([allow('alpha')], deny('secret'))).toEqual([allow('alpha'), deny('secret')])
  })

  it('seeds per domain, not once for the whole rule set', () => {
    expect(addRule([allow('alpha')], deny('bash', 'tool'))).toEqual([
      allow('alpha'), allow(CATCH_ALL_PATTERN, 'tool'), deny('bash', 'tool'),
    ])
  })
})

describe('probeName', () => {
  it('answers an ungoverned domain without consulting a rule', () => {
    expect(probeName([deny('bash', 'tool')], 'skill', 'alpha'))
      .toEqual({ permitted: true, ground: 'open', pattern: undefined })
  })

  it('names the denial that beat a broader allow', () => {
    expect(probeName([allow(CATCH_ALL_PATTERN), deny('secret')], 'skill', 'secret'))
      .toEqual({ permitted: false, ground: 'deny', pattern: 'secret' })
  })

  it('names the allow that granted a name, including through a prefix', () => {
    expect(probeName([allow('web_*')], 'skill', 'web_search'))
      .toEqual({ permitted: true, ground: 'allow', pattern: 'web_*' })
  })

  it('refuses an unmatched name in a governed domain, with no rule to name', () => {
    expect(probeName([allow('alpha')], 'skill', 'beta'))
      .toEqual({ permitted: false, ground: 'unmatched', pattern: undefined })
  })

  it('agrees with memberPermits over every rule set it reports on', () => {
    const rules = [allow(CATCH_ALL_PATTERN), deny('secret'), allow('bash', 'tool')]
    for (const [domain, name] of [['skill', 'alpha'], ['skill', 'secret'], ['tool', 'ls'], ['model', 'x']] as const) {
      expect(probeName(rules, domain, name).permitted).toBe(memberPermits(rules, domain, name))
    }
  })
})
