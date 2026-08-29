/**
 * Workbench-shell plugin, browser half: the CaMeL Science icon rail, the two
 * seats it declares inside itself, and the two frame-wide overlay entries
 * (aurora backdrop, account popover).
 *
 * Nothing here is sci-specific machinery — the rail occupies ui-layout's
 * generic `rail` slot and declares `rail.item`/`rail.footer` as ordinary list
 * seats, so a later view package adds its own button by registering into
 * `rail.item` and never touches this file.
 *
 * The gate is reached over plain same-origin HTTP (sci-gate reverse-proxies
 * this page), so its reads live in `./gate-me.ts` behind a total vocabulary:
 * an unreachable gate reaches the popover as "no account", never as a throw.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// The rail seats' owner share. The sibling value import of CONVERSATION_VIEW
// (./RailItem.tsx) is what makes this row a module-graph request, declared as
// dsh.client.external in package.json.
import type { RailOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the ctx.theme Context merge and the theme/change event.
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { Aurora } from './Aurora.tsx'
import { ConversationRailItem } from './RailItem.tsx'
import { ProfileButton, ThemeToggle, type ThemeToggleInjected } from './RailFooter.tsx'
import { ProfilePopover, type ProfilePopoverInjected } from './ProfilePopover.tsx'
import { SciRail } from './SciRail.tsx'
import { createShellStore } from './stores.ts'
import { fetchBalance, fetchMe, logout } from './gate-me.ts'
import { en, NS, zh, type SciShellKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * View buttons of the icon rail, top-aligned in registration order.
     * Declared by this package's rail occupant; every entry receives the
     * frame's view state, so a button renders its own pressed state and
     * switches views without reaching for `ctx.layout`.
     */
    'rail.item': { kind: 'list'; scope: 'root'; owner: RailOwnerProps }
    /**
     * Bottom-aligned rail controls (palette, account). Same owner share as
     * `rail.item`: a footer control that also routes a view can.
     */
    'rail.footer': { kind: 'list'; scope: 'root'; owner: RailOwnerProps }
  }
  interface LocaleNamespaceMap {
    /** Rail, palette-toggle, and account-popover copy. */
    'sci-shell': SciShellKey
  }
}

// Export discipline: packages/client/AGENTS.md. The Loader exports are the
// whole `/client` surface; same-package tests reach the components, the store
// factory, and the gate reads through their own modules.

/** Required services for the registrations, their dictionaries, and the palette toggle. */
export const inject = ['slots', 'locale', 'layout', 'theme']

/**
 * Client plugin body: register the dictionaries, the rail and its two seats,
 * and the two overlay entries.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // One handle for both readers of the shell state. Declared by the footer
  // avatar and by the overlay popover, the framework resolves it to a single
  // root-scope instance — which is what makes clicking the avatar open the
  // card, and the card's gate read fill the avatar's letter.
  const shell = createShellStore()

  // Both injected faces are built once, not per render: the toggle's
  // `subscribe` identity is a useSyncExternalStore dependency, and the
  // popover's read identities are effect dependencies.
  const themeFace: ThemeToggleInjected = {
    getScheme: () => ctx.theme.getTheme().active.colorScheme,
    setTheme: (id) => { ctx.theme.setTheme(id) },
    subscribe: onChange => ctx.on('theme/change', () => { onChange() }),
  }
  const gateFace: ProfilePopoverInjected = {
    fetchMe: () => fetchMe(),
    fetchBalance: () => fetchBalance(),
    logout: () => logout(),
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sci-shell: dictionaries')

  // slots.inject, not a bare register: ui-layout's frame may activate after
  // this plugin, and a redeclaration must re-install the column.
  ctx.slots.inject('rail', () => ctx.slots.register({
    name: 'rail',
    locale: NS,
    children: {
      'rail.item': { kind: 'list', scope: 'root' },
      'rail.footer': { kind: 'list', scope: 'root' },
    },
  }, SciRail))

  // The two seats below are declared by the registration above; injecting
  // into them (rather than registering directly) is what keeps this file
  // order-independent with itself.
  ctx.slots.inject('rail.item', () => ctx.slots.register({
    name: 'rail.item', id: 'conversation', order: 0, locale: NS,
  }, ConversationRailItem))

  ctx.slots.inject('rail.footer', function* () {
    yield ctx.slots.register({
      name: 'rail.footer', id: 'theme-toggle', order: 0, locale: NS, inject: () => themeFace,
    }, ThemeToggle)
    yield ctx.slots.register({
      name: 'rail.footer', id: 'profile', order: 10, locale: NS, store: shell,
    }, ProfileButton)
  })

  ctx.slots.inject('shell.overlay', function* () {
    // Far below every other overlay entry: the aurora is a backdrop, and
    // anything else registered into this layer must draw over it.
    yield ctx.slots.register({ name: 'shell.overlay', id: 'sci-aurora', order: -100 }, Aurora)
    yield ctx.slots.register({
      name: 'shell.overlay', id: 'sci-profile', order: 50, locale: NS, store: shell, inject: () => gateFace,
    }, ProfilePopover)
  })
}
