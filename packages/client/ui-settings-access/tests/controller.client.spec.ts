/**
 * What the Access controller does with the wire: which endpoint each action
 * calls and with what payload, what a non-administrator makes it NOT call, and
 * how the rule draft survives a reload until it is saved or discarded.
 */
import { describe, expect, it, vi } from 'vitest'
import type {
  AdminGroupView, AdminRuleView, AdminUserView, GroupId, RpcError, RpcId, RpcResponse, RpcResult,
  SessionId, SkillInventory, UserId,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  AccessController, AUTH_CHANNEL, messageOf, type AccessApi, type AccessDeps,
} from '../src/client/access-controller.ts'

const RPC = 'rpc-test' as RpcId
const ADMIN_GROUP = 'admin' as GroupId
const TEAM_GROUP = 'group-2' as GroupId
const ADA = 'user-1' as UserId
const BEN = 'user-2' as UserId
const SESSION = 'session-a' as SessionId

const ok = <T>(value: T): Promise<RpcResponse<T>> =>
  Promise.resolve({ rpcId: RPC, result: { ok: true, value } })
const rejected = <T>(error: RpcError): Promise<RpcResponse<T>> =>
  Promise.resolve({ rpcId: RPC, result: { ok: false, error } })

/** The gateway's refusal of an administration call by a non-administrator. */
const FORBIDDEN: RpcError = { code: 'forbidden', message: 'not an administrator', details: {} }
/** The three seam refusals the forms have to survive, as the gateway wraps them. */
const DUPLICATE_GROUP: RpcError = {
  code: 'auth-rejected', message: 'team exists', details: { authCode: 'duplicate-group-name' },
}
const BUILTIN_GROUP: RpcError = {
  code: 'auth-rejected', message: 'refused', details: { authCode: 'builtin-group' },
}
const UNKNOWN_SUBJECT: RpcError = {
  code: 'auth-rejected', message: 'gone', details: { authCode: 'unknown-subject' },
}

function user(userId: UserId, email: string, disabled = false): AdminUserView {
  return { userId, email, emailVerified: true, disabled, createdAt: 0 }
}

function group(groupId: GroupId, name: string, extra: Partial<AdminGroupView> = {}): AdminGroupView {
  return { groupId, name, builtin: false, createdAt: 0, members: [], rules: [], ...extra }
}

const INVENTORY: SkillInventory = {
  complete: true,
  groups: [{
    source: 'project-dsh',
    rank: 0,
    layer: 'scope',
    skills: [
      { name: 'alpha', description: 'first', authored: { modelInvocable: true, userInvocable: true }, effective: { modelInvocable: true, userInvocable: true }, shadowed: false },
      { name: 'secret', description: 'second', authored: { modelInvocable: true, userInvocable: true }, effective: { modelInvocable: true, userInvocable: true }, shadowed: false },
      { name: 'alpha', description: 'loser', authored: { modelInvocable: true, userInvocable: true }, effective: { modelInvocable: true, userInvocable: true }, shadowed: true },
    ],
  }],
}

/** The nine administration methods plus the inventory, all recording spies. */
function apiDouble(groups: AdminGroupView[], users: AdminUserView[]) {
  const authAdmin = {
    listUsers: vi.fn(() => ok({ users })),
    createUser: vi.fn(() => ok({ userId: BEN })),
    disableUser: vi.fn(() => ok({})),
    listGroups: vi.fn(() => ok({ groups })),
    createGroup: vi.fn(() => ok({ groupId: TEAM_GROUP })),
    deleteGroup: vi.fn(() => ok({})),
    renameGroup: vi.fn(() => ok({})),
    setMembers: vi.fn(() => ok({ added: [] as UserId[] })),
    setRules: vi.fn(() => ok({})),
  }
  const skills = { list: vi.fn(() => ok({ skills: [] })), inventory: vi.fn(() => ok<SkillInventory>(INVENTORY)) }
  return { authAdmin, skills } as unknown as AccessApi & {
    authAdmin: typeof authAdmin
    skills: typeof skills
  }
}

interface BenchOptions {
  me?: () => Promise<RpcResult<unknown>>
  groups?: AdminGroupView[]
  users?: AdminUserView[]
  current?: SessionId | undefined
}

function bench(options: BenchOptions = {}) {
  const groups = options.groups ?? [
    group(ADMIN_GROUP, 'admin', { builtin: true, members: [ADA] }),
    group(TEAM_GROUP, 'team'),
  ]
  const users = options.users ?? [user(ADA, 'ada@example.test'), user(BEN, 'ben@example.test')]
  const api = apiDouble(groups, users)
  const call = vi.fn(
    options.me ?? (() => Promise.resolve({ ok: true as const, value: { authenticated: true, admin: true } })),
  )
  const deps: AccessDeps = {
    api,
    call,
    sessions: {
      getSnapshot: () => ({ current: 'current' in options ? options.current : SESSION }),
      subscribe: () => () => {},
    },
  }
  return { api, call, controller: new AccessController(deps) }
}

describe('reading who is asking', () => {
  it('asks the gate first and loads everything for an administrator', async () => {
    const b = bench()
    await b.controller.refresh()
    expect(b.call).toHaveBeenCalledWith(AUTH_CHANNEL, 'me', {})
    const state = b.controller.store.getSnapshot()
    expect(state.grant).toBe('granted')
    expect(state.status).toBe('ready')
    expect(state.users.map(row => row.email)).toEqual(['ada@example.test', 'ben@example.test'])
    expect(state.groups.map(row => row.name)).toEqual(['admin', 'team'])
    // Shadowed losers are not part of what a member would reach.
    expect(state.skills).toEqual(['alpha', 'secret'])
  })

  it('issues no administration call for a signed-in non-administrator', async () => {
    const b = bench({ me: () => Promise.resolve({ ok: true, value: { authenticated: true, admin: false } }) })
    await b.controller.refresh()
    expect(b.controller.store.getSnapshot().grant).toBe('forbidden')
    expect(b.api.authAdmin.listUsers).not.toHaveBeenCalled()
    expect(b.api.authAdmin.listGroups).not.toHaveBeenCalled()
  })

  it('treats an unmounted /auth channel as a deployment with nothing to administer', async () => {
    const b = bench({ me: () => Promise.reject(new Error('channel "/auth" is unavailable')) })
    await b.controller.refresh()
    expect(b.controller.store.getSnapshot().grant).toBe('absent')
    expect(b.controller.store.getSnapshot().status).toBe('ready')
    expect(b.api.authAdmin.listUsers).not.toHaveBeenCalled()
  })

  it('treats nobody signed in as forbidden rather than as an administrator', async () => {
    const b = bench({ me: () => Promise.resolve({ ok: true, value: { authenticated: false } }) })
    await b.controller.refresh()
    expect(b.controller.store.getSnapshot().grant).toBe('forbidden')
  })

  it('leaves the preview without a catalog when no session is open', async () => {
    const b = bench({ current: undefined })
    await b.controller.refresh()
    expect(b.api.skills.inventory).not.toHaveBeenCalled()
    expect(b.controller.store.getSnapshot().skills).toBeUndefined()
  })
})

describe('account actions', () => {
  it('creates an account with the submitted address and password, then re-reads', async () => {
    const b = bench()
    await b.controller.refresh()
    await b.controller.createUser('cleo@example.test', 'correct-horse')
    expect(b.api.authAdmin.createUser).toHaveBeenCalledWith({
      email: 'cleo@example.test', password: 'correct-horse',
    })
    expect(b.api.authAdmin.listUsers).toHaveBeenCalledTimes(2)
  })

  it('blocks and restores one account through the same endpoint', async () => {
    const b = bench()
    await b.controller.refresh()
    await b.controller.setUserDisabled(BEN, true)
    expect(b.api.authAdmin.disableUser).toHaveBeenCalledWith({ userId: BEN, disabled: true })
    await b.controller.setUserDisabled(BEN, false)
    expect(b.api.authAdmin.disableUser).toHaveBeenLastCalledWith({ userId: BEN, disabled: false })
  })
})

describe('group actions', () => {
  it('creates a group and selects it', async () => {
    const b = bench({ groups: [group(ADMIN_GROUP, 'admin', { builtin: true })] })
    await b.controller.refresh()
    b.api.authAdmin.listGroups.mockImplementation(() => ok({
      groups: [group(ADMIN_GROUP, 'admin', { builtin: true }), group(TEAM_GROUP, 'team')],
    }))
    await b.controller.createGroup('team')
    expect(b.api.authAdmin.createGroup).toHaveBeenCalledWith({ name: 'team' })
    expect(b.controller.store.getSnapshot().selected).toBe(TEAM_GROUP)
  })

  it('renames and deletes a group by id', async () => {
    const b = bench()
    await b.controller.refresh()
    await b.controller.renameGroup(TEAM_GROUP, 'squad')
    expect(b.api.authAdmin.renameGroup).toHaveBeenCalledWith({ groupId: TEAM_GROUP, name: 'squad' })
    b.controller.selectGroup(TEAM_GROUP)
    b.api.authAdmin.listGroups.mockImplementation(() => ok({
      groups: [group(ADMIN_GROUP, 'admin', { builtin: true, members: [ADA] })],
    }))
    await b.controller.deleteGroup(TEAM_GROUP)
    expect(b.api.authAdmin.deleteGroup).toHaveBeenCalledWith({ groupId: TEAM_GROUP })
    expect(b.controller.store.getSnapshot().selected).toBeUndefined()
  })

  it('keeps a selection that a delete of another group did not touch', async () => {
    const b = bench()
    await b.controller.refresh()
    b.controller.selectGroup(ADMIN_GROUP)
    await b.controller.deleteGroup(TEAM_GROUP)
    expect(b.controller.store.getSnapshot().selected).toBe(ADMIN_GROUP)
  })

  it('saves the whole membership when one account is added or removed', async () => {
    const b = bench()
    await b.controller.refresh()
    await b.controller.setMember(ADMIN_GROUP, BEN, true)
    expect(b.api.authAdmin.setMembers).toHaveBeenCalledWith({ groupId: ADMIN_GROUP, userIds: [ADA, BEN] })
    await b.controller.setMember(ADMIN_GROUP, ADA, false)
    expect(b.api.authAdmin.setMembers).toHaveBeenLastCalledWith({ groupId: ADMIN_GROUP, userIds: [] })
  })

  it('adds an account already in the group exactly once', async () => {
    const b = bench()
    await b.controller.refresh()
    await b.controller.setMember(ADMIN_GROUP, ADA, true)
    expect(b.api.authAdmin.setMembers).toHaveBeenCalledWith({ groupId: ADMIN_GROUP, userIds: [ADA] })
  })
})

describe('the rule draft', () => {
  const denySecret: AdminRuleView = { domain: 'skill', pattern: 'secret', effect: 'deny' }
  const allowEverything: AdminRuleView = { domain: 'skill', pattern: '*', effect: 'allow' }

  it('starts from the selected group’s saved rules', async () => {
    const b = bench({
      groups: [group(TEAM_GROUP, 'team', { rules: [denySecret] })],
    })
    await b.controller.refresh()
    b.controller.selectGroup(TEAM_GROUP)
    expect(b.controller.store.getSnapshot().draft).toEqual([denySecret])
    expect(b.controller.store.getSnapshot().dirty).toBe(false)
  })

  it('seeds the catch-all with a domain’s first denial and reports that it did', async () => {
    const b = bench()
    await b.controller.refresh()
    b.controller.selectGroup(TEAM_GROUP)
    b.controller.addDraftRule('skill', 'secret', 'deny')
    const state = b.controller.store.getSnapshot()
    expect(state.draft).toEqual([allowEverything, denySecret])
    expect(state.seededDomain).toBe('skill')
    expect(state.dirty).toBe(true)
  })

  it('does not report seeding for a rule that needed none', async () => {
    const b = bench()
    await b.controller.refresh()
    b.controller.selectGroup(TEAM_GROUP)
    b.controller.addDraftRule('skill', 'alpha', 'allow')
    expect(b.controller.store.getSnapshot().seededDomain).toBeUndefined()
  })

  it('removes one rule by position and forgets the seeding notice', async () => {
    const b = bench()
    await b.controller.refresh()
    b.controller.selectGroup(TEAM_GROUP)
    b.controller.addDraftRule('skill', 'secret', 'deny')
    b.controller.removeDraftRule(0)
    expect(b.controller.store.getSnapshot().draft).toEqual([denySecret])
    expect(b.controller.store.getSnapshot().seededDomain).toBeUndefined()
  })

  it('saves the draft to the selected group and settles clean', async () => {
    const b = bench()
    await b.controller.refresh()
    b.controller.selectGroup(TEAM_GROUP)
    b.controller.addDraftRule('skill', 'secret', 'deny')
    await b.controller.saveRules()
    expect(b.api.authAdmin.setRules).toHaveBeenCalledWith({
      groupId: TEAM_GROUP, rules: [allowEverything, denySecret],
    })
    expect(b.controller.store.getSnapshot().dirty).toBe(false)
  })

  it('discards back to the saved rules', async () => {
    const b = bench({ groups: [group(TEAM_GROUP, 'team', { rules: [denySecret] })] })
    await b.controller.refresh()
    b.controller.selectGroup(TEAM_GROUP)
    b.controller.addDraftRule('skill', 'alpha', 'allow')
    b.controller.discardRules()
    expect(b.controller.store.getSnapshot().draft).toEqual([denySecret])
    expect(b.controller.store.getSnapshot().dirty).toBe(false)
  })

  it('opens an empty draft for a group that has since been deleted', async () => {
    const b = bench()
    await b.controller.refresh()
    b.controller.selectGroup('group-gone' as GroupId)
    expect(b.controller.store.getSnapshot().draft).toEqual([])
  })

  it('discards to nothing when the selection is already gone', async () => {
    const b = bench()
    await b.controller.refresh()
    b.controller.discardRules()
    expect(b.controller.store.getSnapshot().draft).toEqual([])
  })

  it('survives a reload while dirty and re-syncs once clean', async () => {
    const b = bench()
    await b.controller.refresh()
    b.controller.selectGroup(TEAM_GROUP)
    b.controller.addDraftRule('skill', 'alpha', 'allow')
    b.api.authAdmin.listGroups.mockImplementation(() => ok({
      groups: [group(ADMIN_GROUP, 'admin', { builtin: true }), group(TEAM_GROUP, 'team', { rules: [denySecret] })],
    }))
    await b.controller.setUserDisabled(BEN, true)
    expect(b.controller.store.getSnapshot().draft).toEqual([{ domain: 'skill', pattern: 'alpha', effect: 'allow' }])
    b.controller.discardRules()
    await b.controller.setUserDisabled(BEN, false)
    expect(b.controller.store.getSnapshot().draft).toEqual([denySecret])
  })
})

describe('failures', () => {
  it('reports a rejected business result with its code', async () => {
    const b = bench()
    b.api.authAdmin.listUsers.mockImplementation(() => rejected(FORBIDDEN))
    await b.controller.refresh()
    const state = b.controller.store.getSnapshot()
    expect(state.error).toBe('forbidden: not an administrator')
    expect(state.status).toBe('error')
    expect(state.busy).toBe(false)
  })

  it('reports a transport rejection and stops the read there', async () => {
    const b = bench()
    b.api.authAdmin.listGroups.mockImplementation(() => Promise.reject(new Error('offline')))
    await b.controller.refresh()
    expect(b.controller.store.getSnapshot().error).toBe('offline')
    expect(b.api.skills.inventory).not.toHaveBeenCalled()
  })

  it('keeps a settled page on a failed write instead of blanking it', async () => {
    const b = bench()
    await b.controller.refresh()
    b.api.authAdmin.createGroup.mockImplementation(() => rejected(DUPLICATE_GROUP))
    await b.controller.createGroup('team')
    const state = b.controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.error).toBe('auth-rejected: team exists')
    expect(state.selected).toBeUndefined()
  })

  it('leaves a failed delete selection alone', async () => {
    const b = bench()
    await b.controller.refresh()
    b.controller.selectGroup(TEAM_GROUP)
    b.api.authAdmin.deleteGroup.mockImplementation(() => rejected(BUILTIN_GROUP))
    await b.controller.deleteGroup(TEAM_GROUP)
    expect(b.controller.store.getSnapshot().selected).toBe(TEAM_GROUP)
  })

  it('leaves the draft dirty when the save is refused', async () => {
    const b = bench()
    await b.controller.refresh()
    b.controller.selectGroup(TEAM_GROUP)
    b.controller.addDraftRule('skill', 'alpha', 'allow')
    b.api.authAdmin.setRules.mockImplementation(() => rejected(UNKNOWN_SUBJECT))
    await b.controller.saveRules()
    expect(b.controller.store.getSnapshot().dirty).toBe(true)
  })

  it('leaves the skill catalog unset when the inventory read fails', async () => {
    const b = bench()
    b.api.skills.inventory.mockImplementation(() => rejected(FORBIDDEN))
    await b.controller.refresh()
    expect(b.controller.store.getSnapshot().skills).toBeUndefined()
  })

  it('renders a non-Error rejection as its own text', () => {
    expect(messageOf('plain string')).toBe('plain string')
    expect(messageOf(new Error('boom'))).toBe('boom')
  })
})

describe('the injected face', () => {
  it('forwards every action to the controller', async () => {
    const b = bench()
    await b.controller.refresh()
    const t = ((key: string) => key) as never
    const face = b.controller.inject(t)
    expect(face.hooks.access).toBe(b.controller.store)
    face.selectGroup(TEAM_GROUP)
    face.addDraftRule('skill', 'secret', 'deny')
    face.removeDraftRule(0)
    face.discardRules()
    face.refresh()
    face.createUser('cleo@example.test', 'pw')
    face.setUserDisabled(BEN, true)
    face.createGroup('team')
    face.renameGroup(TEAM_GROUP, 'squad')
    face.setMember(ADMIN_GROUP, BEN, true)
    face.saveRules()
    face.deleteGroup(TEAM_GROUP)
    await vi.waitFor(() => {
      expect(b.api.authAdmin.createUser).toHaveBeenCalled()
      expect(b.api.authAdmin.disableUser).toHaveBeenCalled()
      expect(b.api.authAdmin.createGroup).toHaveBeenCalled()
      expect(b.api.authAdmin.renameGroup).toHaveBeenCalled()
      expect(b.api.authAdmin.setRules).toHaveBeenCalled()
      expect(b.api.authAdmin.setMembers).toHaveBeenCalled()
      expect(b.api.authAdmin.deleteGroup).toHaveBeenCalled()
    })
  })
})
