import { describe, expect, it } from 'vitest'
import {
  ADMIN_GROUP_ID,
  GroupId,
  LOCAL_PRINCIPAL,
  PERMITS_EVERYTHING,
  PERMITS_NOTHING,
  UserId,
  checkForSessionOwner,
  evaluate,
  governs,
  matchesPattern,
  permits,
  type AuthService,
  type PermissionRule,
  type Principal,
} from '../src/index.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

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
    expect(permits(member, [allow('bash')], 'tool', 'grep')).toBe(false)
  })
})

describe('domain-scoped governance', () => {
  it('reports a domain governed only once a rule addresses it', () => {
    expect(governs([], 'tool')).toBe(false)
    expect(governs([allow('bash')], 'tool')).toBe(true)
    expect(governs([allow('bash')], 'skill')).toBe(false)
    expect(governs([{ domain: 'skill', pattern: 'x', effect: 'deny' }], 'skill')).toBe(true)
  })

  it('grants every name in a domain no rule addresses, so a rule-less group takes nothing away', () => {
    expect(permits(member, [], 'tool', 'bash')).toBe(true)
    expect(permits(member, [], 'skill', 'anything')).toBe(true)
    expect(permits(member, [], 'model', 'deepseek/deepseek-chat')).toBe(true)
    expect(permits(member, [], 'settings-section', 'llm')).toBe(true)
  })

  it('governs only the domains named, leaving the others open', () => {
    const rules = [allow('bash')]
    expect(permits(member, rules, 'tool', 'grep')).toBe(false)
    expect(permits(member, rules, 'skill', 'grep')).toBe(true)
  })

  it('keeps an allowlist exact once its domain is governed', () => {
    expect(permits(member, [allow('bash')], 'tool', 'bash')).toBe(true)
    expect(permits(member, [deny('bash')], 'tool', 'grep')).toBe(false)
  })
})

describe('the check one agent session\'s owner decides', () => {
  const SESSION = 'session-1' as SessionId

  /** An auth double answering only the three reads this helper makes. */
  function auth(options: {
    owner?: UserId
    principal?: Principal
    rules?: PermissionRule[]
  }): AuthService {
    return {
      ownerOfSession: () => Promise.resolve(options.owner),
      principalOf: () => Promise.resolve(options.principal),
      rulesFor: () => Promise.resolve(options.rules ?? []),
    } as unknown as AuthService
  }

  it('grants everything for a session recorded before authentication existed', async () => {
    const check = await checkForSessionOwner(auth({}), SESSION)
    expect(check).toBe(PERMITS_EVERYTHING)
    expect(check('tool', 'bash')).toBe(true)
  })

  it('grants nothing for an owner the provider can no longer resolve', async () => {
    const check = await checkForSessionOwner(auth({ owner: UserId('u-gone') }), SESSION)
    expect(check).toBe(PERMITS_NOTHING)
    expect(check('tool', 'bash')).toBe(false)
  })

  it('evaluates the owner\'s rules, one domain at a time', async () => {
    const check = await checkForSessionOwner(
      auth({ owner: UserId('u-1'), principal: member, rules: [allow('bash')] }),
      SESSION,
    )
    expect(check('tool', 'bash')).toBe(true)
    expect(check('tool', 'grep')).toBe(false)
    expect(check('skill', 'anything')).toBe(true)
  })

  it('grants an administrator owner everything a deny rule refuses', async () => {
    const check = await checkForSessionOwner(
      auth({ owner: UserId('u-1'), principal: admin, rules: [deny('*')] }),
      SESSION,
    )
    expect(check('tool', 'bash')).toBe(true)
  })
})
