import { describe, expect, it } from 'vitest'
import {
  ADMIN_GROUP_ID,
  GroupId,
  LOCAL_PRINCIPAL,
  UserId,
  evaluate,
  matchesPattern,
  permits,
  type PermissionRule,
  type Principal,
} from '../src/index.ts'

const allow = (pattern: string): PermissionRule => ({ domain: 'tool', pattern, effect: 'allow' })
const deny = (pattern: string): PermissionRule => ({ domain: 'tool', pattern, effect: 'deny' })

const member: Principal = {
  kind: 'user',
  userId: UserId('u-1'),
  email: 'member@example.test',
  groups: [GroupId('g-1')],
  admin: false,
}

const admin: Principal = { ...member, groups: [ADMIN_GROUP_ID], admin: true }

describe('pattern matching', () => {
  it('matches an exact name only', () => {
    expect(matchesPattern('web_search', 'web_search')).toBe(true)
    expect(matchesPattern('web_search', 'web_search_2')).toBe(false)
    expect(matchesPattern('web_search', 'Web_Search')).toBe(false)
  })

  it('treats a trailing star as a prefix and any other star as a literal', () => {
    expect(matchesPattern('web_*', 'web_search')).toBe(true)
    expect(matchesPattern('web_*', 'web_')).toBe(true)
    expect(matchesPattern('web_*', 'grep')).toBe(false)
    expect(matchesPattern('*', '')).toBe(true)
    expect(matchesPattern('*', 'anything')).toBe(true)
    expect(matchesPattern('web*search', 'web_search')).toBe(false)
    expect(matchesPattern('web*search', 'web*search')).toBe(true)
  })

  it('spans the route separator in the model domain', () => {
    expect(matchesPattern('deepseek/*', 'deepseek/deepseek-chat')).toBe(true)
    expect(matchesPattern('deepseek/*', 'openai/gpt')).toBe(false)
    expect(matchesPattern('deep*', 'deepseek/deepseek-chat')).toBe(true)
  })
})

describe('rule precedence', () => {
  it('refuses a name no rule covers', () => {
    expect(evaluate([], 'tool', 'bash')).toBe(false)
    expect(evaluate([allow('web_*')], 'tool', 'bash')).toBe(false)
  })

  it('grants a name an allow rule covers', () => {
    expect(evaluate([allow('bash')], 'tool', 'bash')).toBe(true)
    expect(evaluate([allow('ba*')], 'tool', 'bash')).toBe(true)
  })

  it('lets one deny beat any number of allows, in either order', () => {
    expect(evaluate([allow('*'), deny('bash')], 'tool', 'bash')).toBe(false)
    expect(evaluate([deny('bash'), allow('*')], 'tool', 'bash')).toBe(false)
    expect(evaluate([allow('bash'), allow('ba*'), deny('ba*')], 'tool', 'bash')).toBe(false)
  })

  it('ignores rules addressed at another domain', () => {
    const rules: PermissionRule[] = [
      { domain: 'skill', pattern: '*', effect: 'allow' },
      { domain: 'tool', pattern: '*', effect: 'deny' },
    ]
    expect(evaluate(rules, 'skill', 'anything')).toBe(true)
    expect(evaluate(rules, 'tool', 'anything')).toBe(false)
    expect(evaluate(rules, 'model', 'deepseek/deepseek-chat')).toBe(false)
    expect(evaluate(rules, 'settings-section', 'llm')).toBe(false)
  })
})

describe('principal bypass', () => {
  it('grants the local principal everything, rules or not', () => {
    expect(permits(LOCAL_PRINCIPAL, [deny('*')], 'tool', 'bash')).toBe(true)
    expect(permits(LOCAL_PRINCIPAL, [], 'model', 'deepseek/deepseek-chat')).toBe(true)
  })

  it('grants an admin everything, including a name a deny rule covers', () => {
    expect(permits(admin, [deny('*')], 'tool', 'bash')).toBe(true)
  })

  it('evaluates rules for an ordinary user', () => {
    expect(permits(member, [allow('bash')], 'tool', 'bash')).toBe(true)
    expect(permits(member, [allow('bash'), deny('bash')], 'tool', 'bash')).toBe(false)
    expect(permits(member, [], 'tool', 'bash')).toBe(false)
  })
})
