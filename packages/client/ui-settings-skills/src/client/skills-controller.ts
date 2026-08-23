/**
 * Skills settings page controller: one snapshot joining the session-addressed
 * skill inventory (`skill.inventory`) with the `skills` settings namespace that
 * overrides each skill's authored invocation policy. The Host stays the single
 * fact source — a toggle writes one override through the settings scope and the
 * page re-reads the inventory, so what renders is always what the Host resolved.
 */

import type {
  IApiClient, SessionId, SkillInventory, SkillPolicyOverrideView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ObservableSnapshot, SessionListState, SettingsScope, SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SkillsTranslate } from './locales.ts'

/**
 * Settings namespace owning per-skill invocation overrides. Spelled here rather
 * than imported: a client package must not depend on a Host package, and the
 * skill registry that owns it spells the same value.
 */
export const SKILLS_SETTINGS_NS = 'skills'

/** The stored `skills` section: one override per skill name. */
export type SkillPolicyOverrides = Readonly<Record<string, SkillPolicyOverrideView>>

/** The session-list facts this page reads: which session is current, and its cwd. */
export type SkillsSessionSource = ObservableSnapshot<Pick<SessionListState, 'current' | 'byId'>>

/** The generation-scoped Host facts this page reads: the account home. */
export type SkillsHostSource = ObservableSnapshot<{ home: string } | undefined>

/** Page snapshot. */
export interface SkillsSectionState {
  /** `idle` until the section first renders; `ready` also covers the no-session view. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Working directory the inventory was read for; undefined when no session is current. */
  cwd: string | undefined
  /** Host account home, for the POSIX `~` abbreviation of discovery roots. */
  home: string | undefined
  /** Last accepted inventory; undefined before the first answer and while no session is current. */
  inventory: SkillInventory | undefined
  /** Whole-page failure text; set only with status `error`. */
  error: string | undefined
  /** Whether the `skills` settings namespace accepts writes here. */
  writable: boolean
}

/** The registration-side face the section's slot entry injects. */
export interface SkillsSectionFace {
  hooks: {
    /** Page snapshot bound by the renderer as useSkills. */
    skills: SnapshotStore<SkillsSectionState>
  }
  /** Re-read the inventory for the current session. */
  refresh(): void
  /**
   * Store this skill's model-invocation override, keeping any user override.
   * @param name - skill name addressed by the row.
   * @param next - whether model-facing catalogs should include it.
   */
  setModel(name: string, next: boolean): void
  /**
   * Store this skill's user-invocation override, keeping any model override.
   * @param name - skill name addressed by the row.
   * @param next - whether user-facing catalogs should include it.
   */
  setUser(name: string, next: boolean): void
  /**
   * Clear this skill's stored override, restoring the authored policy.
   * @param name - skill name addressed by the row.
   */
  reset(name: string): void
  /** Section copy. */
  t: SkillsTranslate
}

/**
 * Human text for a rejected wire call. A transport failure rejects with an
 * Error; a host or a runtime can reject with anything, and the page still has
 * to say something.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The skills settings page controller (one per settings surface). */
export class SkillsSectionController {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<SkillsSectionState> = createSnapshotStore<SkillsSectionState>({
    status: 'idle', cwd: undefined, home: undefined, inventory: undefined, error: undefined, writable: false,
  })

  /** Latest read wins; an older answer never overwrites a newer one. */
  private generation = 0
  /** Session the last read was addressed to, so unrelated list churn refetches nothing. */
  private readAt: SessionId | undefined
  private readonly disposers: (() => void)[]

  /**
   * @param api - the wire face (the skills domain only).
   * @param sessions - the session-list feed naming the current session and its cwd.
   * @param scope - the bound settings scope for the `skills` namespace.
   * @param host - the connection's Host description, for the account home.
   */
  constructor(
    private readonly api: Pick<IApiClient, 'skills'>,
    private readonly sessions: SkillsSessionSource,
    private readonly scope: SettingsScope<SkillPolicyOverrides>,
    host: SkillsHostSource,
  ) {
    this.disposers = [
      sessions.subscribe(() => { this.onSessionsChanged() }),
      scope.subscribe(() => { this.syncWritable() }),
      host.subscribe(() => { this.syncHome(host.getSnapshot()?.home) }),
    ]
    this.syncHome(host.getSnapshot()?.home)
    this.syncWritable()
  }

  /**
   * Re-read the inventory for the current session. No session is a settled
   * empty view rather than a failure: discovery is cwd-scoped, so there is
   * nothing to address yet.
   * @returns settlement after the read and its snapshot update.
   */
  async refresh(): Promise<void> {
    const generation = ++this.generation
    const { current, byId } = this.sessions.getSnapshot()
    this.readAt = current
    if (current === undefined) {
      this.store.update((draft) => {
        draft.status = 'ready'
        draft.cwd = undefined
        draft.inventory = undefined
        draft.error = undefined
      })
      return
    }
    const cwd = byId[current]?.cwd
    this.store.update((draft) => {
      draft.status = 'loading'
      draft.cwd = cwd
      draft.error = undefined
    })
    let inventory: SkillInventory
    try {
      const { result } = await this.api.skills.inventory({ sessionId: current })
      if (!result.ok) {
        this.fail(generation, `${result.error.code}: ${result.error.message}`)
        return
      }
      inventory = result.value
    } catch (transportFailure) {
      this.fail(generation, messageOf(transportFailure))
      return
    }
    if (generation !== this.generation) return
    this.store.update((draft) => {
      draft.status = 'ready'
      draft.inventory = inventory
      draft.error = undefined
    })
  }

  /**
   * Store this skill's model-invocation override and re-read the inventory.
   * @param name - skill name addressed by the row.
   * @param next - whether model-facing catalogs should include it.
   */
  setModel(name: string, next: boolean): void {
    this.override(name, { model: next })
  }

  /**
   * Store this skill's user-invocation override and re-read the inventory.
   * @param name - skill name addressed by the row.
   * @param next - whether user-facing catalogs should include it.
   */
  setUser(name: string, next: boolean): void {
    this.override(name, { user: next })
  }

  /**
   * Clear this skill's stored override and re-read the inventory.
   * @param name - skill name addressed by the row.
   */
  reset(name: string): void {
    this.settle(this.scope.unset(name))
  }

  /**
   * Build the face the section's slot registration injects.
   * @param t - this namespace's bound translate.
   * @returns the page snapshot and the row actions.
   */
  inject(t: SkillsTranslate): SkillsSectionFace {
    return {
      hooks: { skills: this.store },
      refresh: () => { void this.refresh() },
      setModel: (name, next) => { this.setModel(name, next) },
      setUser: (name, next) => { this.setUser(name, next) },
      reset: (name) => { this.reset(name) },
      t,
    }
  }

  /** Release the session, settings, and Host-description subscriptions. */
  dispose(): void {
    for (const dispose of this.disposers) dispose()
    this.disposers.length = 0
  }

  /**
   * One override write, preserving the surface the user did not touch: the two
   * toggles address one stored entry, so a partial patch would silently drop
   * the other decision.
   */
  private override(name: string, patch: SkillPolicyOverrideView): void {
    this.settle(this.scope.set(name, { ...this.storedOverride(name), ...patch }))
  }

  /** The stored override behind the winning row for this name, or none. */
  private storedOverride(name: string): SkillPolicyOverrideView {
    for (const group of this.store.getSnapshot().inventory?.groups ?? []) {
      for (const entry of group.skills) {
        if (entry.name === name && !entry.shadowed) return entry.override ?? {}
      }
    }
    return {}
  }

  /** A settled write is the earliest point the Host's own resolution is readable. */
  private settle(write: Promise<void>): void {
    void write.then(() => { void this.refresh() })
  }

  /** A list refresh that did not move the current session refetches nothing. */
  private onSessionsChanged(): void {
    if (this.store.getSnapshot().status === 'idle') return
    if (this.sessions.getSnapshot().current === this.readAt) return
    void this.refresh()
  }

  private syncHome(home: string | undefined): void {
    this.store.update((draft) => { draft.home = home })
  }

  private syncWritable(): void {
    const snapshot = this.scope.getSnapshot()
    const writable = snapshot.writable && snapshot.status !== 'unavailable'
    this.store.update((draft) => { draft.writable = writable })
  }

  private fail(generation: number, error: string): void {
    if (generation !== this.generation) return
    this.store.update((draft) => {
      draft.status = 'error'
      draft.error = error
    })
  }
}
