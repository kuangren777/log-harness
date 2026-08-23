/**
 * Access administration controller: one snapshot over the nine `auth.admin.*`
 * wire methods, plus the rule draft the editor previews before it saves.
 *
 * Reading `me` first is what decides whether anything renders. The Host
 * refuses every administration call from a non-administrator on its own, so
 * the check here buys no safety — it buys silence: a page that would answer
 * `forbidden` to every request is worse than a page that says why it is empty,
 * and asking first also keeps the surface from issuing calls it knows will be
 * refused.
 */

import type {
  AdminGroupView, AdminRuleView, AdminUserView, GroupId, IApiClient, RpcResponse, RpcResult,
  SessionId, UserId,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot, SessionListState, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { AccessTranslate } from './locales.ts'
import { addRule, CATCH_ALL_PATTERN, hasRule, type AccessDomain } from './rules.ts'

/**
 * The channel the request gate serves its endpoints under. Spelled here rather
 * than imported: a client plugin depends on neither the gate nor a sibling
 * feature package, and both spell the same value.
 */
export const AUTH_CHANNEL = '/auth'

/** Whether this browser may administer anything, and why not when it may not. */
export type AccessGrant =
  /** The first `me` has not answered yet. */
  | 'unknown'
  /** No request gate answered, so this deployment administers no accounts. */
  | 'absent'
  /** Somebody is asking who is not an administrator. */
  | 'forbidden'
  /** An administrator is asking. */
  | 'granted'

/** Everything the Access section renders from. */
export interface AccessState {
  /** `idle` until the section first renders. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whether administration is available to this browser. */
  grant: AccessGrant
  /** Every account, as the roster call returned it. */
  users: readonly AdminUserView[]
  /** Every group with its membership and saved rules. */
  groups: readonly AdminGroupView[]
  /** The group the membership and rules editors address. */
  selected: GroupId | undefined
  /** The selected group's rules including unsaved edits; the preview reads these. */
  draft: readonly AdminRuleView[]
  /** Whether `draft` differs from what the selected group carries. */
  dirty: boolean
  /** Set when the last add seeded a catch-all allow, so the editor can say it did. */
  seeded: boolean
  /** Skill names discovered for the current session; undefined when no session is open. */
  skills: readonly string[] | undefined
  /** The last failure's text, shown above the forms until the next call succeeds. */
  error: string | undefined
  /** A call is in flight: the forms disable themselves. */
  busy: boolean
}

/** The registration-side face the section's slot entry injects. */
export interface AccessFace {
  hooks: {
    /** Page snapshot bound by the renderer as useAccess. */
    access: SnapshotStore<AccessState>
  }
  /** Read `me`, then the roster, the groups, and the skill catalog. */
  refresh(): void
  /**
   * Register an account with an initial password.
   * @param email - the new account's address.
   * @param password - the password to hand its owner.
   */
  createUser(email: string, password: string): void
  /**
   * Block or restore one account.
   * @param userId - the account addressed.
   * @param disabled - true blocks it, false restores it.
   */
  setUserDisabled(userId: UserId, disabled: boolean): void
  /**
   * Create an empty group.
   * @param name - the new group's name.
   */
  createGroup(name: string): void
  /**
   * Rename a group.
   * @param groupId - the group addressed.
   * @param name - its new name.
   */
  renameGroup(groupId: GroupId, name: string): void
  /**
   * Delete a group with its memberships and rules.
   * @param groupId - the group addressed.
   */
  deleteGroup(groupId: GroupId): void
  /**
   * Point the membership and rules editors at one group, discarding any draft.
   * @param groupId - the group addressed.
   */
  selectGroup(groupId: GroupId): void
  /**
   * Add or remove one account from one group, saving the whole membership.
   * @param groupId - the group addressed.
   * @param userId - the account being moved.
   * @param member - whether it should belong afterwards.
   */
  setMember(groupId: GroupId, userId: UserId, member: boolean): void
  /**
   * Append one rule to the draft, seeding a catch-all allow with a domain's
   * first denial.
   * @param domain - the namespace the rule addresses.
   * @param pattern - exact name, or a prefix ending in `*`.
   * @param effect - whether a match grants or refuses.
   */
  addDraftRule(domain: AccessDomain, pattern: string, effect: AdminRuleView['effect']): void
  /**
   * Drop one rule from the draft.
   * @param index - the rule's position in the draft.
   */
  removeDraftRule(index: number): void
  /** Save the draft as the selected group's rules. */
  saveRules(): void
  /** Throw the draft away and go back to the saved rules. */
  discardRules(): void
  /** Section copy. */
  t: AccessTranslate
}

/** The wire methods this controller calls. */
export type AccessApi = Pick<IApiClient, 'authAdmin' | 'skills'>

/** The session-list facts the preview reads: which session is current. */
export type AccessSessionSource = ObservableSnapshot<Pick<SessionListState, 'current'>>

/** Everything the controller reaches outside itself. */
export interface AccessDeps {
  /** The typed `/api` face carrying `auth.admin.*` and `skill.inventory`. */
  api: AccessApi
  /** Call one `/auth` endpoint; rejects when no gate serves the channel. */
  call(channel: string, endpoint: string, payload: unknown): Promise<RpcResult<unknown>>
  /** The session list, for the session the skill preview is discovered against. */
  sessions: AccessSessionSource
}

/**
 * Human text for a rejected wire call.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The Access administration page controller (one per settings surface). */
export class AccessController {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<AccessState> = createSnapshotStore<AccessState>({
    status: 'idle',
    grant: 'unknown',
    users: [],
    groups: [],
    selected: undefined,
    draft: [],
    dirty: false,
    seeded: false,
    skills: undefined,
    error: undefined,
    busy: false,
  })

  /**
   * @param deps - the typed wire face, the `/auth` channel caller, and the session list.
   */
  constructor(private readonly deps: AccessDeps) {}

  /**
   * Read who is asking and, for an administrator, everything the page shows.
   * @returns settlement after the last read.
   */
  async refresh(): Promise<void> {
    this.store.update((draft) => {
      draft.status = draft.status === 'ready' ? 'ready' : 'loading'
      draft.error = undefined
    })
    const grant = await this.readGrant()
    this.store.update((draft) => { draft.grant = grant })
    if (grant !== 'granted') {
      this.store.update((draft) => { draft.status = 'ready' })
      return
    }
    if (!await this.reload()) return
    if (!await this.readSkills()) return
    this.store.update((draft) => { draft.status = 'ready' })
  }

  /**
   * Register an account and re-read the roster.
   * @param email - the new account's address.
   * @param password - the password to hand its owner.
   * @returns settlement after the write and the re-read.
   */
  async createUser(email: string, password: string): Promise<void> {
    await this.write(() => this.deps.api.authAdmin.createUser({ email, password }))
  }

  /**
   * Block or restore one account and re-read the roster.
   * @param userId - the account addressed.
   * @param disabled - true blocks it, false restores it.
   * @returns settlement after the write and the re-read.
   */
  async setUserDisabled(userId: UserId, disabled: boolean): Promise<void> {
    await this.write(() => this.deps.api.authAdmin.disableUser({ userId, disabled }))
  }

  /**
   * Create an empty group and select it.
   * @param name - the new group's name.
   * @returns settlement after the write and the re-read.
   */
  async createGroup(name: string): Promise<void> {
    const created = await this.write(() => this.deps.api.authAdmin.createGroup({ name }))
    if (created === undefined) return
    this.selectGroup(created.groupId)
  }

  /**
   * Rename a group and re-read.
   * @param groupId - the group addressed.
   * @param name - its new name.
   * @returns settlement after the write and the re-read.
   */
  async renameGroup(groupId: GroupId, name: string): Promise<void> {
    await this.write(() => this.deps.api.authAdmin.renameGroup({ groupId, name }))
  }

  /**
   * Delete a group and re-read; a builtin group is refused by the Host.
   * @param groupId - the group addressed.
   * @returns settlement after the write and the re-read.
   */
  async deleteGroup(groupId: GroupId): Promise<void> {
    const deleted = await this.write(() => this.deps.api.authAdmin.deleteGroup({ groupId }))
    if (deleted === undefined) return
    if (this.store.getSnapshot().selected !== groupId) return
    this.store.update((draft) => {
      draft.selected = undefined
      draft.draft = []
      draft.dirty = false
      draft.seeded = false
    })
  }

  /**
   * Point the editors at one group and reset its draft to the saved rules.
   * @param groupId - the group addressed.
   */
  selectGroup(groupId: GroupId): void {
    this.store.update((draft) => {
      draft.selected = groupId
      draft.draft = rulesOf(draft.groups, groupId)
      draft.dirty = false
      draft.seeded = false
      draft.error = undefined
    })
  }

  /**
   * Save one group's whole membership with this account added or removed.
   * @param groupId - the group addressed.
   * @param userId - the account being moved.
   * @param member - whether it should belong afterwards.
   * @returns settlement after the write and the re-read.
   */
  async setMember(groupId: GroupId, userId: UserId, member: boolean): Promise<void> {
    const group = this.store.getSnapshot().groups.find(candidate => candidate.groupId === groupId)
    /* v8 ignore next -- the membership list only renders rows for groups in the snapshot */
    if (group === undefined) return
    const without = group.members.filter(candidate => candidate !== userId)
    const userIds = member ? [...without, userId] : without
    await this.write(() => this.deps.api.authAdmin.setMembers({ groupId, userIds }))
  }

  /**
   * Append one rule to the draft, seeding a catch-all allow when it is the
   * first rule its domain carries and it denies.
   * @param domain - the namespace the rule addresses.
   * @param pattern - exact name, or a prefix ending in `*`.
   * @param effect - whether a match grants or refuses.
   */
  addDraftRule(domain: AccessDomain, pattern: string, effect: AdminRuleView['effect']): void {
    const current = this.store.getSnapshot().draft
    const next = addRule(current, { domain, pattern, effect })
    const catchAll: AdminRuleView = { domain, pattern: CATCH_ALL_PATTERN, effect: 'allow' }
    const seeded = hasRule(next, catchAll) && !hasRule(current, catchAll)
    this.store.update((state) => {
      state.draft = next
      state.dirty = true
      state.seeded = seeded
    })
  }

  /**
   * Drop one rule from the draft.
   * @param index - the rule's position in the draft.
   */
  removeDraftRule(index: number): void {
    const next = this.store.getSnapshot().draft.filter((_rule, at) => at !== index)
    this.store.update((state) => {
      state.draft = next
      state.dirty = true
      state.seeded = false
    })
  }

  /**
   * Save the draft as the selected group's rules.
   * @returns settlement after the write and the re-read.
   */
  async saveRules(): Promise<void> {
    const { selected, draft } = this.store.getSnapshot()
    /* v8 ignore next -- the rules editor only renders with a group selected */
    if (selected === undefined) return
    const saved = await this.write(() => this.deps.api.authAdmin.setRules({ groupId: selected, rules: [...draft] }))
    if (saved === undefined) return
    this.store.update((state) => {
      state.dirty = false
      state.seeded = false
    })
  }

  /** Throw the draft away and go back to the saved rules. */
  discardRules(): void {
    this.store.update((state) => {
      state.draft = state.selected === undefined ? [] : rulesOf(state.groups, state.selected)
      state.dirty = false
      state.seeded = false
    })
  }

  /**
   * Build the face the section's slot registration injects.
   * @param t - this namespace's bound translate.
   * @returns the page snapshot and every administration action.
   */
  inject(t: AccessTranslate): AccessFace {
    return {
      hooks: { access: this.store },
      refresh: () => { void this.refresh() },
      createUser: (email, password) => { void this.createUser(email, password) },
      setUserDisabled: (userId, disabled) => { void this.setUserDisabled(userId, disabled) },
      createGroup: (name) => { void this.createGroup(name) },
      renameGroup: (groupId, name) => { void this.renameGroup(groupId, name) },
      deleteGroup: (groupId) => { void this.deleteGroup(groupId) },
      selectGroup: (groupId) => { this.selectGroup(groupId) },
      setMember: (groupId, userId, member) => { void this.setMember(groupId, userId, member) },
      addDraftRule: (domain, pattern, effect) => { this.addDraftRule(domain, pattern, effect) },
      removeDraftRule: (index) => { this.removeDraftRule(index) },
      saveRules: () => { void this.saveRules() },
      discardRules: () => { this.discardRules() },
      t,
    }
  }

  /** Ask the gate who this browser is; a channel with no route is a deployment with no accounts. */
  private async readGrant(): Promise<AccessGrant> {
    let result: RpcResult<unknown>
    try {
      result = await this.deps.call(AUTH_CHANNEL, 'me', {})
    } catch {
      // No route for `/auth`: nothing here mounts authentication.
      return 'absent'
    }
    /* v8 ignore next -- `me` takes an empty payload, so the gate has nothing to reject */
    if (!result.ok) return 'absent'
    const value = result.value as { authenticated?: boolean; admin?: boolean }
    return value.authenticated === true && value.admin === true ? 'granted' : 'forbidden'
  }

  /**
   * Re-read the roster and the groups, keeping any selection and unsaved draft.
   * A failed read stops the sequence: the snapshot already carries its message,
   * and a later call clearing it would hide the failure that mattered.
   * @returns whether both reads answered.
   */
  private async reload(): Promise<boolean> {
    const users = await this.unwrap(() => this.deps.api.authAdmin.listUsers({}))
    if (users === undefined) return false
    this.store.update((draft) => { draft.users = users.users })
    const groups = await this.unwrap(() => this.deps.api.authAdmin.listGroups({}))
    if (groups === undefined) return false
    const selected = this.store.getSnapshot().selected
    const survives = selected !== undefined && groups.groups.some(group => group.groupId === selected)
    const saved = survives ? rulesOf(groups.groups, selected) : []
    this.store.update((state) => {
      state.groups = groups.groups
      if (!survives) {
        state.selected = undefined
        state.draft = []
        state.dirty = false
        return
      }
      if (!state.dirty) state.draft = saved
    })
    return true
  }

  /**
   * Read the skill catalog the preview resolves against, for the current session.
   * @returns whether the catalog is settled (no session is settled, not failed).
   */
  private async readSkills(): Promise<boolean> {
    const sessionId: SessionId | undefined = this.deps.sessions.getSnapshot().current
    if (sessionId === undefined) {
      this.store.update((draft) => { draft.skills = undefined })
      return true
    }
    const inventory = await this.unwrap(() => this.deps.api.skills.inventory({ sessionId }))
    if (inventory === undefined) return false
    // Shadowed losers never reach a member either way: a nearer definition
    // already claimed the name, so listing them would answer for a skill the
    // catalog does not serve.
    const names = inventory.groups.flatMap(
      group => group.skills.filter(entry => !entry.shadowed).map(entry => entry.name),
    )
    this.store.update((draft) => { draft.skills = names })
    return true
  }

  /** One write, then the re-read that makes the Host's own answer what renders. */
  private async write<T>(call: () => Promise<RpcResponse<T>>): Promise<T | undefined> {
    const value = await this.unwrap(call)
    if (value === undefined) return undefined
    await this.reload()
    return value
  }

  /** One call: busy while it runs, the snapshot's error text when it fails. */
  private async unwrap<T>(call: () => Promise<RpcResponse<T>>): Promise<T | undefined> {
    this.store.update((draft) => {
      draft.busy = true
      draft.error = undefined
    })
    let response: RpcResponse<T>
    try {
      response = await call()
    } catch (transportFailure) {
      this.fail(messageOf(transportFailure))
      return undefined
    }
    if (!response.result.ok) {
      this.fail(`${response.result.error.code}: ${response.result.error.message}`)
      return undefined
    }
    this.store.update((draft) => { draft.busy = false })
    return response.result.value
  }

  private fail(error: string): void {
    this.store.update((draft) => {
      draft.busy = false
      draft.error = error
      if (draft.status !== 'ready') draft.status = 'error'
    })
  }
}

/** A copy of one group's saved rules, or nothing when the group is gone. */
function rulesOf(groups: readonly AdminGroupView[], groupId: GroupId): AdminRuleView[] {
  return [...groups.find(group => group.groupId === groupId)?.rules ?? []]
}
