/**
 * What the permission rules take away from a request that already passed its
 * policy row. The policy table decides WHO may call a method; these cases
 * decide what the answer contains and which writes it refuses, for the same
 * caller and the same method.
 *
 * Every case drives the real gateway implementation, so a filter added to the
 * wrong projection (the rendered view rather than the source list) fails here.
 */

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { GroupId, UserId } from '@deepseek-ai/dsh-auth'
import type { AuditEntry, AuthService, PermissionRule, Principal } from '@deepseek-ai/dsh-auth'
import { AuthError } from '@deepseek-ai/dsh-auth'
import { RpcId, type AuthorizedRequest } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'

const MEMBER = UserId('user-member')
const ADMIN = UserId('user-admin')

const member: Principal = {
  kind: 'user', userId: MEMBER, email: 'member@example.test', groups: [GroupId('g-1')], admin: false,
}
const administrator: Principal = {
  kind: 'user', userId: ADMIN, email: 'admin@example.test', groups: [GroupId('admin')], admin: true,
}

let nextRpc = 0
function request<P>(payload: P, principal: Principal): AuthorizedRequest<P> {
  return { rpcId: RpcId(`perm-${String(nextRpc++)}`), payload, principal }
}

/** The rules the harness's auth double serves to {@link MEMBER}. */
const RULES: PermissionRule[] = [
  { domain: 'skill', pattern: 'allowed-skill', effect: 'allow' },
  { domain: 'model', pattern: 'open/*', effect: 'allow' },
  { domain: 'settings-section', pattern: 'open-ns', effect: 'allow' },
]

interface AuthState {
  users: { userId: UserId; email: string; emailVerifiedAt?: number; disabledAt?: number; createdAt: number }[]
  groups: { groupId: GroupId; name: string; builtin: boolean; createdAt: number }[]
  members: Map<GroupId, UserId[]>
  rules: Map<GroupId, PermissionRule[]>
  audit: AuditEntry[]
  disabled: Map<UserId, boolean>
  /** Fails the next write with this seam error, to pin the `auth-rejected` mapping. */
  refuse: AuthError | undefined
}

/**
 * An auth provider double over in-memory state. Small enough to read, and real
 * enough that `members.set` genuinely computes its added set from what the
 * store held before the write.
 */
function authDouble(state: AuthState): AuthService {
  const refuseOnce = (): void => {
    const error = state.refuse
    if (error === undefined) return
    state.refuse = undefined
    throw error
  }
  return {
    rulesFor: (userId: UserId) => Promise.resolve(userId === MEMBER ? RULES : []),
    listUsers: () => Promise.resolve(state.users.map(user => ({
      userId: user.userId,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      disabledAt: state.disabled.get(user.userId) === true ? 1 : user.disabledAt,
      createdAt: user.createdAt,
    }))),
    createUser: (email: string) => {
      refuseOnce()
      const userId = UserId(`user-${email}`)
      state.users.push({ userId, email, createdAt: 0 })
      return Promise.resolve(userId)
    },
    setUserDisabled: (userId: UserId, disabled: boolean) => {
      refuseOnce()
      state.disabled.set(userId, disabled)
      return Promise.resolve()
    },
    listGroups: () => Promise.resolve(state.groups),
    createGroup: (name: string) => {
      refuseOnce()
      const groupId = GroupId(`group-${name}`)
      state.groups.push({ groupId, name, builtin: false, createdAt: 0 })
      return Promise.resolve(groupId)
    },
    deleteGroup: (groupId: GroupId) => {
      refuseOnce()
      state.groups = state.groups.filter(group => group.groupId !== groupId)
      return Promise.resolve()
    },
    renameGroup: (groupId: GroupId, name: string) => {
      refuseOnce()
      state.groups = state.groups.map(group => group.groupId === groupId ? { ...group, name } : group)
      return Promise.resolve()
    },
    listMembers: (groupId: GroupId) => Promise.resolve(state.members.get(groupId) ?? []),
    setMembers: (groupId: GroupId, userIds: readonly UserId[]) => {
      refuseOnce()
      state.members.set(groupId, [...userIds])
      return Promise.resolve()
    },
    listRules: (groupId: GroupId) => Promise.resolve(state.rules.get(groupId) ?? []),
    setRules: (groupId: GroupId, rules: readonly PermissionRule[]) => {
      refuseOnce()
      state.rules.set(groupId, [...rules])
      return Promise.resolve()
    },
    audit: (entry: AuditEntry) => {
      state.audit.push(entry)
      return Promise.resolve()
    },
    ownerOfSession: () => Promise.resolve(undefined),
    ownerOfWorkspace: () => Promise.resolve(undefined),
  } as unknown as AuthService
}

/** Fresh administration state: two accounts and one non-builtin group. */
function freshState(): AuthState {
  return {
    users: [
      { userId: MEMBER, email: 'member@example.test', createdAt: 1 },
      { userId: ADMIN, email: 'admin@example.test', emailVerifiedAt: 5, createdAt: 2 },
    ],
    groups: [{ groupId: GroupId('g-1'), name: 'reviewers', builtin: false, createdAt: 3 }],
    members: new Map([[GroupId('g-1'), [MEMBER]]]),
    rules: new Map(),
    audit: [],
    disabled: new Map(),
    refuse: undefined,
  }
}

/** Two discovered skills, one of which the member's rules allow. */
const SKILL_SUMMARIES = [
  { name: 'allowed-skill', description: 'Allowed', invocation: { modelInvocable: true, userInvocable: true } },
  { name: 'secret-skill', description: 'Secret', invocation: { modelInvocable: true, userInvocable: true } },
]

const SKILL_INVENTORY = {
  complete: true,
  groups: [{
    source: 'filesystem',
    rank: 0,
    layer: 'global' as const,
    skills: SKILL_SUMMARIES.map(skill => ({
      name: skill.name,
      description: skill.description,
      path: `/skills/${skill.name}`,
      authored: skill.invocation,
      effective: skill.invocation,
      shadowed: false,
    })),
  }],
}

/** Two provider routes, one of which the member's rules allow. */
const LLM_DOUBLE = {
  listProviders: () => [{ id: 'open', name: 'Open' }, { id: 'closed', name: 'Closed' }],
  listModels: (provider: string) => Promise.resolve([{ id: `${provider}-model`, name: provider }]),
  resolveModelInfo: () => Promise.resolve({}),
  listConfigurableProviders: () => [],
  resolveCallConfig: (selection: { provider: string; model: string }) => Promise.resolve(selection),
}

/** Two registered settings namespaces, one of which the member's rules allow. */
function settingsDouble(writes: string[]) {
  const descriptor = (ns: string) => ({ ns, schema: {}, value: {}, applies: 'live' as const, secrets: [], revision: 1 })
  return {
    writable: true,
    documentPath: '/settings.yml',
    describe: () => [descriptor('open-ns'), descriptor('closed-ns')],
    update: (ns: string) => {
      writes.push(ns)
      return Promise.resolve()
    },
    replace: (ns: string) => {
      writes.push(ns)
      return Promise.resolve()
    },
    mutate: (ns: string) => {
      writes.push(ns)
      return Promise.resolve()
    },
    prepareDocument: () => Promise.resolve('/settings.yml'),
  }
}

async function harness(
  state: AuthState = freshState(),
  notify: (email: string, groupName: string) => Promise<void> = () => Promise.resolve(),
) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-perm-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  ctx.provide('auth', authDouble(state) as never)
  ctx.provide('llm', LLM_DOUBLE as never)
  ctx.provide('skills', {
    list: () => Promise.resolve(SKILL_SUMMARIES),
    inventory: () => Promise.resolve(SKILL_INVENTORY),
  } as never)
  const settingsWrites: string[] = []
  ctx.provide('settings', settingsDouble(settingsWrites) as never)
  const notices: { email: string; groupName: string }[] = []
  ctx.provide('authGate', {
    notifyAddedToGroup: async (email: string, groupName: string) => {
      await notify(email, groupName)
      notices.push({ email, groupName })
    },
  } as never)
  ctx.sessions.create(SessionId('s-1'), { meta: { cwd } })
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'open', model: 'open-model' }),
    cwd,
    openTextFile: () => Promise.resolve(),
  })
  return { api, ctx, cwd, state, notices, settingsWrites }
}

describe('the skill domain', () => {
  it('omits a refused skill from the composer catalog and keeps it for an administrator', async () => {
    const { api } = await harness()

    const restricted = await api.skills.list(request({ sessionId: SessionId('s-1') }, member))
    const privileged = await api.skills.list(request({ sessionId: SessionId('s-1') }, administrator))

    expect(restricted.result).toMatchObject({ ok: true, value: { skills: [{ name: 'allowed-skill' }] } })
    expect(privileged.result.ok && privileged.result.value.skills.map(skill => skill.name))
      .toEqual(['allowed-skill', 'secret-skill'])
  })

  it('omits a refused skill from the inventory while keeping its origin group', async () => {
    const { api } = await harness()

    const restricted = await api.skills.inventory(request({ sessionId: SessionId('s-1') }, member))
    const privileged = await api.skills.inventory(request({ sessionId: SessionId('s-1') }, administrator))

    expect(restricted.result).toMatchObject({
      ok: true,
      value: { complete: true, groups: [{ source: 'filesystem', skills: [{ name: 'allowed-skill' }] }] },
    })
    // Nothing about the refused entry survives — not its path, not its name.
    expect(JSON.stringify(restricted.result)).not.toContain('secret-skill')
    expect(privileged.result.ok && privileged.result.value.groups[0]?.skills.map(skill => skill.name))
      .toEqual(['allowed-skill', 'secret-skill'])
  })
})

describe('the model domain', () => {
  it('advertises only the routes the caller may use, dropping a wholly refused provider', async () => {
    const { api } = await harness()

    const restricted = await api.llm.models(request({}, member))
    const privileged = await api.llm.models(request({}, administrator))

    expect(restricted.result.ok && restricted.result.value.groups.map(group => group.id)).toEqual(['open'])
    expect(privileged.result.ok && privileged.result.value.groups.map(group => group.id)).toEqual(['open', 'closed'])
  })

  it('refuses the picker before it resolves a refused route', async () => {
    const { api } = await harness()

    const refused = await api.sessions.selectModel(
      request({ sessionId: SessionId('s-1'), provider: 'closed', model: 'closed-model' }, member),
    )

    expect(refused.result).toMatchObject({ ok: false, error: { code: 'forbidden' } })
  })
})

describe('the settings domain', () => {
  it('describes only the namespaces the caller may reach', async () => {
    const { api } = await harness()

    const restricted = await api.settings.describe(request({}, member))
    const privileged = await api.settings.describe(request({}, administrator))

    expect(restricted.result.ok && restricted.result.value.namespaces.map(view => view.ns)).toEqual(['open-ns'])
    expect(privileged.result.ok && privileged.result.value.namespaces.map(view => view.ns))
      .toEqual(['open-ns', 'closed-ns'])
  })

  it('refuses every write to a namespace the caller may not reach, without touching the seam', async () => {
    const { api, settingsWrites } = await harness()

    const update = await api.settings.update(request({ ns: 'closed-ns', patch: {} }, member))
    const replace = await api.settings.replace(request({ ns: 'closed-ns', section: {} }, member))
    const mutate = await api.settings.mutate(request({ ns: 'closed-ns', ops: [] }, member))

    for (const response of [update, replace, mutate]) {
      expect(response.result).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    }
    expect(settingsWrites).toEqual([])

    const allowed = await api.settings.update(request({ ns: 'open-ns', patch: {} }, member))
    expect(allowed.result.ok).toBe(true)
    expect(settingsWrites).toEqual(['open-ns'])
  })

  it('refuses the raw document to a caller who may not write every namespace', async () => {
    const { api } = await harness()
    const signal = new AbortController().signal

    const refused = await api.settings.openDocument(request({}, member), signal)
    const opened = await api.settings.openDocument(request({}, administrator), signal)

    expect(refused.result).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    expect(opened.result).toMatchObject({ ok: true, value: { opened: true } })
  })
})

describe('the administration plane', () => {
  it('rosters accounts without anything that could authenticate as one', async () => {
    const { api } = await harness()

    const response = await api.authAdmin.listUsers(request({}, administrator))

    expect(response.result).toMatchObject({
      ok: true,
      value: {
        users: [
          { userId: MEMBER, email: 'member@example.test', emailVerified: false, disabled: false, createdAt: 1 },
          { userId: ADMIN, email: 'admin@example.test', emailVerified: true, disabled: false, createdAt: 2 },
        ],
      },
    })
    expect(JSON.stringify(response.result)).not.toContain('password')
  })

  it('creates, disables, and restores an account, auditing the acting administrator each time', async () => {
    const { api, state } = await harness()

    const created = await api.authAdmin.createUser(request({ email: 'new@example.test', password: 'pw' }, administrator))
    expect(created.result.ok).toBe(true)
    await api.authAdmin.disableUser(request({ userId: MEMBER, disabled: true }, administrator))
    expect(state.disabled.get(MEMBER)).toBe(true)
    await api.authAdmin.disableUser(request({ userId: MEMBER, disabled: false }, administrator))
    expect(state.disabled.get(MEMBER)).toBe(false)

    expect(state.audit.map(entry => entry.event)).toEqual([
      'auth.admin.user-created', 'auth.admin.user-disabled', 'auth.admin.user-restored',
    ])
    expect(state.audit.every(entry => entry.actorUserId === ADMIN)).toBe(true)
  })

  it('reads each group with its membership and rules, and edits both', async () => {
    const { api, state } = await harness()

    const created = await api.authAdmin.createGroup(request({ name: 'auditors' }, administrator))
    expect(created.result.ok).toBe(true)
    await api.authAdmin.renameGroup(request({ groupId: GroupId('g-1'), name: 'renamed' }, administrator))
    await api.authAdmin.setRules(request({
      groupId: GroupId('g-1'),
      rules: [{ domain: 'tool' as const, pattern: 'bash', effect: 'deny' as const }],
    }, administrator))

    const groups = await api.authAdmin.listGroups(request({}, administrator))
    expect(groups.result).toMatchObject({
      ok: true,
      value: {
        groups: [
          { groupId: GroupId('g-1'), name: 'renamed', members: [MEMBER], rules: [{ domain: 'tool', pattern: 'bash', effect: 'deny' }] },
          { groupId: GroupId('group-auditors'), name: 'auditors', members: [], rules: [] },
        ],
      },
    })

    await api.authAdmin.deleteGroup(request({ groupId: GroupId('group-auditors') }, administrator))
    expect(state.groups.map(group => group.name)).toEqual(['renamed'])
    expect(state.audit.map(entry => entry.event)).toEqual([
      'auth.admin.group-created', 'auth.admin.group-renamed', 'auth.admin.rules-set', 'auth.admin.group-deleted',
    ])
  })

  it('mails exactly the newly added members, and mails nobody on a repeat save', async () => {
    const { api, state, notices } = await harness()

    const first = await api.authAdmin.setMembers(request({ groupId: GroupId('g-1'), userIds: [MEMBER, ADMIN] }, administrator))

    expect(first.result).toMatchObject({ ok: true, value: { added: [ADMIN] } })
    // MEMBER was already in the group, so only the account this save added is told.
    expect(notices).toEqual([{ email: 'admin@example.test', groupName: 'reviewers' }])
    expect(state.audit.at(-1)).toMatchObject({
      event: 'auth.admin.members-set', actorUserId: ADMIN, subject: 'g-1', detail: '2 member(s), 1 added',
    })

    const again = await api.authAdmin.setMembers(request({ groupId: GroupId('g-1'), userIds: [MEMBER, ADMIN] }, administrator))
    expect(again.result).toMatchObject({ ok: true, value: { added: [] } })
    expect(notices).toHaveLength(1)
  })

  it('saves the membership even when the notice cannot be delivered', async () => {
    const { api, state } = await harness(freshState(), () => Promise.reject(new Error('mail server unreachable')))

    const response = await api.authAdmin.setMembers(request({ groupId: GroupId('g-1'), userIds: [ADMIN] }, administrator))

    expect(response.result).toMatchObject({ ok: true, value: { added: [ADMIN] } })
    expect(state.members.get(GroupId('g-1'))).toEqual([ADMIN])
  })

  it('carries a seam refusal to the wire with its code', async () => {
    const state = freshState()
    state.refuse = new AuthError('duplicate-email', 'an account already exists for that address')
    const { api } = await harness(state)

    const response = await api.authAdmin.createUser(request({ email: 'member@example.test', password: 'pw' }, administrator))

    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'auth-rejected', details: { authCode: 'duplicate-email' } },
    })
  })
})
