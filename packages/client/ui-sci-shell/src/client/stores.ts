/**
 * Shell state shared by the rail's avatar button and the account popover.
 * One handle is constructed in `apply` and declared by both registrations, so
 * the framework resolves them to a single root-scope instance: the button
 * draws the initial of the same account the popover read, and clicking the
 * button is what the popover observes.
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { GateBalance, GateMe } from './gate-me.ts'

/** The shell's shared state. */
export interface ShellState {
  /** Whether the account popover shows. */
  open: boolean
  /** True once the gate read settled, either way. */
  loaded: boolean
  /** The signed-in account, or null while unread or unreachable. */
  me: GateMe | null
  /** The tenant balance, or null when the gate reports none. */
  balance: GateBalance | null
}

/** Declared action shape, so the exported factory keeps a stable return type. */
type ShellActions = {
  toggleProfile: (draft: ShellState) => void
  closeProfile: (draft: ShellState) => void
  settleIdentity: (draft: ShellState, me: GateMe | null, balance: GateBalance | null) => void
}

/**
 * Declares the shell's shared state and its complete write surface.
 * @returns the store handle (one per plugin body — never a module singleton).
 */
export function createShellStore(): EngineStoreHandle<ShellState, ShellActions> {
  return defineStore({
    init: (): ShellState => ({ open: false, loaded: false, me: null, balance: null }),
    actions: {
      toggleProfile: (d) => { d.open = !d.open },
      closeProfile: (d) => { d.open = false },
      settleIdentity: (d, me: GateMe | null, balance: GateBalance | null) => {
        d.me = me
        d.balance = balance
        d.loaded = true
      },
    },
  })
}

/** The shell's store handle type, for the components' `PropsStore` share. */
export type ShellStore = ReturnType<typeof createShellStore>

/**
 * The avatar glyph for one account: the email's first letter, upper-cased.
 * @param email - the account email (empty while the gate is unread).
 * @returns the single-character glyph, or `?` when there is no email yet.
 */
export function avatarGlyph(email: string): string {
  const first = email.trim().charAt(0)
  return first === '' ? '?' : first.toUpperCase()
}

/**
 * The VM a session points at, matched by stable id rather than by slug.
 * @param me - the account, or null.
 * @returns the selected VM row, or undefined when none is selected.
 */
export function selectedVmOf(me: GateMe | null): GateVmRow | undefined {
  if (me === null || me.selectedVm === null) return undefined
  return me.vms.find(vm => vm.id === me.selectedVm)
}

/** Local alias so the selector's return type stays readable at call sites. */
type GateVmRow = GateMe['vms'][number]
