/**
 * What the Skills page controller does with the wire and the settings scope:
 * session-addressed reads, latest-read-wins, override merging, and the
 * invalidations that make it re-read.
 */
import { describe, expect, it, vi } from 'vitest'
import type { IApiClient, RpcId, SessionId, SkillInventory } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  SessionSummary, SettingsScope, SettingsScopeSnapshot, SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  messageOf, SKILLS_SETTINGS_NS, SkillsSectionController, type SkillPolicyOverrides,
} from '../src/client/skills-controller.ts'

const RPC = 'rpc-test' as RpcId
const SESSION = 'session-a' as SessionId
const OTHER = 'session-b' as SessionId

/** A one-group inventory whose single entry carries the given override state. */
function inventory(overrides: Partial<SkillInventory> = {}): SkillInventory {
  return {
    groups: [{
      source: 'project-dsh',
      rank: 0,
      root: '/proj/.dsh/skills',
      layer: 'scope',
      skills: [
        {
          name: 'alpha',
          description: 'first',
          authored: { modelInvocable: true, userInvocable: true },
          effective: { modelInvocable: false, userInvocable: true },
          override: { model: false },
          shadowed: false,
        },
        {
          name: 'beta',
          description: 'second',
          authored: { modelInvocable: true, userInvocable: true },
          effective: { modelInvocable: true, userInvocable: true },
          shadowed: false,
        },
        {
          name: 'gamma',
          description: 'loser',
          authored: { modelInvocable: true, userInvocable: true },
          effective: { modelInvocable: true, userInvocable: true },
          override: { user: false },
          shadowed: true,
        },
      ],
    }],
    complete: true,
    ...overrides,
  }
}

/** One session-list row carrying the cwd the inventory is discovered from. */
function summary(id: SessionId, cwd: string): SessionSummary {
  return { id, displayTitle: id, cwd, running: false, blank: false, updatedAt: 0 }
}

type SessionFacts = { current: SessionId | undefined; byId: Record<SessionId, SessionSummary> }

function sessionSource(current: SessionId | undefined): SnapshotStore<SessionFacts> {
  return createSnapshotStore<SessionFacts>({
    current,
    byId: { [SESSION]: summary(SESSION, '/proj'), [OTHER]: summary(OTHER, '/other') },
  })
}

function scopeDouble(snapshot: Partial<SettingsScopeSnapshot<SkillPolicyOverrides>> = {}) {
  const store = createSnapshotStore<SettingsScopeSnapshot<SkillPolicyOverrides>>({
    status: 'ready',
    value: {},
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host',
    ...snapshot,
  })
  const sets: { field: string; value: unknown }[] = []
  const unsets: string[] = []
  const scope: SettingsScope<SkillPolicyOverrides> = {
    getSnapshot: () => store.getSnapshot(),
    subscribe: listener => store.subscribe(listener),
    set: (field, value) => {
      sets.push({ field, value })
      return Promise.resolve()
    },
    unset: (field) => {
      unsets.push(field)
      return Promise.resolve()
    },
  }
  return { scope, store, sets, unsets }
}

/** The skills wire face, answering each call from the queued answers in order. */
function skillsApi(answers: readonly (SkillInventory | Error | { code: string; message: string })[]) {
  const calls: SessionId[] = []
  let cursor = 0
  const inventoryCall = vi.fn(async (payload: { sessionId: SessionId }) => {
    calls.push(payload.sessionId)
    const answer = answers[Math.min(cursor++, answers.length - 1)]
    if (answer instanceof Error) throw answer
    if (answer !== undefined && 'code' in answer) {
      return { rpcId: RPC, result: { ok: false as const, error: { ...answer, details: {} } } }
    }
    return { rpcId: RPC, result: { ok: true as const, value: answer as SkillInventory } }
  })
  const api = { skills: { inventory: inventoryCall } } as unknown as Pick<IApiClient, 'skills'>
  return { api, calls, inventoryCall }
}

function hostSource(home: string | undefined): SnapshotStore<{ home: string } | undefined> {
  return createSnapshotStore<{ home: string } | undefined>(home === undefined ? undefined : { home })
}

function bench(options: {
  current?: SessionId | undefined
  answers?: readonly (SkillInventory | Error | { code: string; message: string })[]
  scope?: Partial<SettingsScopeSnapshot<SkillPolicyOverrides>>
  home?: string | undefined
} = {}) {
  const sessions = sessionSource('current' in options ? options.current : SESSION)
  const wire = skillsApi(options.answers ?? [inventory()])
  const settings = scopeDouble(options.scope)
  const host = hostSource('home' in options ? options.home : '/home/dev')
  const controller = new SkillsSectionController(wire.api, sessions, settings.scope, host)
  return { controller, sessions, settings, host, ...wire }
}

describe('SkillsSectionController', () => {
  it('names the namespace the skill registry owns', () => {
    expect(SKILLS_SETTINGS_NS).toBe('skills')
  })

  it('reads the inventory for the current session and its cwd', async () => {
    const b = bench()
    expect(b.controller.store.getSnapshot()).toMatchObject({ status: 'idle', writable: true, home: '/home/dev' })
    await b.controller.refresh()
    expect(b.calls).toEqual([SESSION])
    expect(b.controller.store.getSnapshot()).toMatchObject({
      status: 'ready', cwd: '/proj', error: undefined,
    })
    expect(b.controller.store.getSnapshot().inventory?.groups[0]?.source).toBe('project-dsh')
    b.controller.dispose()
  })

  it('settles into an empty view when no session is current', async () => {
    const b = bench({ current: undefined })
    await b.controller.refresh()
    expect(b.calls).toEqual([])
    expect(b.controller.store.getSnapshot()).toMatchObject({
      status: 'ready', cwd: undefined, inventory: undefined,
    })
    b.controller.dispose()
  })

  it('reports a business rejection and a transport failure as page errors', async () => {
    const rejected = bench({ answers: [{ code: 'session-not-found', message: 'gone' }] })
    await rejected.controller.refresh()
    expect(rejected.controller.store.getSnapshot()).toMatchObject({
      status: 'error', error: 'session-not-found: gone',
    })
    rejected.controller.dispose()

    const thrown = bench({ answers: [new Error('socket closed')] })
    await thrown.controller.refresh()
    expect(thrown.controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'socket closed' })
    thrown.controller.dispose()
  })

  it('keeps the surface the user did not touch when storing an override', async () => {
    const b = bench()
    await b.controller.refresh()

    b.controller.setUser('alpha', false)
    await vi.waitFor(() => { expect(b.settings.sets).toHaveLength(1) })
    expect(b.settings.sets[0]).toEqual({ field: 'alpha', value: { model: false, user: false } })
    // A settled write is the earliest point the Host's resolution is readable.
    await vi.waitFor(() => { expect(b.calls).toHaveLength(2) })

    b.controller.setModel('beta', false)
    await vi.waitFor(() => { expect(b.settings.sets).toHaveLength(2) })
    expect(b.settings.sets[1]).toEqual({ field: 'beta', value: { model: false } })
    b.controller.dispose()
  })

  it('writes a bare override before any inventory has arrived', async () => {
    const b = bench()
    b.controller.setUser('alpha', false)
    await vi.waitFor(() => { expect(b.settings.sets).toEqual([{ field: 'alpha', value: { user: false } }]) })
    b.controller.dispose()
  })

  it('ignores a shadowed row and an unknown name when reading the stored override', async () => {
    const b = bench()
    await b.controller.refresh()
    b.controller.setModel('gamma', false)
    b.controller.setModel('delta', false)
    await vi.waitFor(() => { expect(b.settings.sets).toHaveLength(2) })
    expect(b.settings.sets.map(entry => entry.value)).toEqual([{ model: false }, { model: false }])
    b.controller.dispose()
  })

  it('clears an override and re-reads', async () => {
    const b = bench()
    await b.controller.refresh()
    b.controller.reset('alpha')
    await vi.waitFor(() => { expect(b.settings.unsets).toEqual(['alpha']) })
    await vi.waitFor(() => { expect(b.calls).toHaveLength(2) })
    b.controller.dispose()
  })

  it('keeps the loaded list mounted while a later read is in flight', async () => {
    const b = bench({ answers: [inventory(), inventory({ complete: false })] })
    await b.controller.refresh()
    const pending = b.controller.refresh()
    // A re-read never returns to the progress placeholder once rows exist:
    // the previous inventory stays until the answer replaces it in place.
    expect(b.controller.store.getSnapshot()).toMatchObject({ status: 'ready', inventory: { complete: true } })
    await pending
    expect(b.controller.store.getSnapshot()).toMatchObject({ status: 'ready', inventory: { complete: false } })
    b.controller.dispose()
  })

  it('projects a toggle onto its row before the write settles, and a reset back to the authored policy', async () => {
    const b = bench()
    await b.controller.refresh()
    const row = (name: string) => {
      for (const group of b.controller.store.getSnapshot().inventory!.groups) {
        const entry = group.skills.find(skill => skill.name === name && !skill.shadowed)
        if (entry !== undefined) return entry
      }
      throw new Error(`no winning row ${name}`)
    }
    b.controller.setModel('beta', false)
    expect(row('beta').effective.modelInvocable).toBe(false)
    expect(row('beta').override).toEqual({ model: false })
    expect(row('beta').effective.userInvocable).toBe(row('beta').authored.userInvocable)
    b.controller.reset('alpha')
    expect(row('alpha').override).toBeUndefined()
    expect(row('alpha').effective).toEqual(row('alpha').authored)
    await vi.waitFor(() => { expect(b.settings.unsets).toEqual(['alpha']) })
    b.controller.dispose()
  })

  it('lets the latest read win over an older one still in flight', async () => {
    const b = bench({ answers: [inventory(), inventory({ complete: false })] })
    const stale = b.controller.refresh()
    const fresh = b.controller.refresh()
    await Promise.all([stale, fresh])
    expect(b.controller.store.getSnapshot().inventory?.complete).toBe(false)
    b.controller.dispose()
  })

  it('drops a superseded failure instead of overwriting the newer answer', async () => {
    const b = bench({ answers: [new Error('stale'), inventory()] })
    const stale = b.controller.refresh()
    const fresh = b.controller.refresh()
    await Promise.all([stale, fresh])
    expect(b.controller.store.getSnapshot().status).toBe('ready')
    b.controller.dispose()
  })

  it('re-reads when the current session moves, and only then', async () => {
    const b = bench()
    // An unopened page does not fetch on background list churn.
    b.sessions.update((draft) => { draft.current = OTHER })
    expect(b.calls).toEqual([])

    await b.controller.refresh()
    expect(b.calls).toEqual([OTHER])
    // Unrelated list churn (a row's recency) leaves the read alone.
    b.sessions.update((draft) => { draft.byId[OTHER] = summary(OTHER, '/other') })
    expect(b.calls).toHaveLength(1)

    b.sessions.update((draft) => { draft.current = SESSION })
    await vi.waitFor(() => { expect(b.calls).toEqual([OTHER, SESSION]) })
    b.controller.dispose()
  })

  it('follows the settings document writability and the Host home', () => {
    const b = bench()
    b.settings.store.update((draft) => { draft.writable = false })
    expect(b.controller.store.getSnapshot().writable).toBe(false)
    // A namespace this deployment does not serve is not writable either.
    b.settings.store.update((draft) => { draft.writable = true; draft.status = 'unavailable' })
    expect(b.controller.store.getSnapshot().writable).toBe(false)

    b.host.set({ home: '/home/other' })
    expect(b.controller.store.getSnapshot().home).toBe('/home/other')
    b.controller.dispose()
    // Disposal releases every subscription.
    b.host.set({ home: '/home/third' })
    expect(b.controller.store.getSnapshot().home).toBe('/home/other')
  })

  it('starts with no home when the connection has not handshaked', () => {
    const b = bench({ home: undefined })
    expect(b.controller.store.getSnapshot().home).toBeUndefined()
    b.controller.dispose()
  })

  it('injects the page snapshot and the row actions', async () => {
    const b = bench()
    const t = ((key: string) => key) as Parameters<typeof b.controller.inject>[0]
    const face = b.controller.inject(t)
    expect(face.hooks.skills).toBe(b.controller.store)
    expect(face.t).toBe(t)

    face.refresh()
    await vi.waitFor(() => { expect(b.calls).toHaveLength(1) })
    face.setModel('beta', false)
    face.setUser('beta', false)
    face.reset('alpha')
    await vi.waitFor(() => { expect(b.settings.sets).toHaveLength(2) })
    expect(b.settings.unsets).toEqual(['alpha'])
    b.controller.dispose()
  })

  it('describes a rejection value that is not an Error', () => {
    expect(messageOf('plain')).toBe('plain')
    expect(messageOf(new Error('boom'))).toBe('boom')
  })
})
