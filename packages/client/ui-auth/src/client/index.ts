/**
 * Sign-in plugin, browser half. It registers two surfaces over one controller:
 * the sign-in card in the shell overlay layer, and the account row at the
 * sidebar foot.
 *
 * Mounting it is harmless in a deployment that does not authenticate. The
 * controller's first call is `me` on the `/auth` channel, and a channel no
 * request gate registered has no route, so the call fails at the transport and
 * both surfaces stay hidden for the page's life.
 *
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ui-layout's SlotMap merge (the 'shell.overlay' entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.footer.action' entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { AccountIndicator } from './AccountIndicator.tsx'
import { AuthGateView } from './AuthGateView.tsx'
import { AuthController } from './auth-controller.ts'
import { en, zh, type AuthKey, type AuthTranslate } from './locales.ts'

export type { AccountIndicatorInjected, AccountIndicatorProps } from './AccountIndicator.tsx'
export type { AuthGateInjected, AuthGateViewProps } from './AuthGateView.tsx'
export type {
  AuthDeps, AuthFace, AuthLanding, AuthNotice, AuthState, AuthView,
} from './auth-controller.ts'
export type { AuthKey, AuthTranslate } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The sign-in surface's copy. */
    auth: AuthKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'auth'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection']

/**
 * The page facts the controller needs, read once at apply. A page with no
 * `location` at all (a headless mount) lands on neither mailed path and never
 * reloads, which leaves the surface driven entirely by the `/auth` answers.
 * @returns the landing URL and the shell reboot.
 */
function pageAccess(): Pick<import('./auth-controller.ts').AuthDeps, 'landing' | 'reload'> {
  const page = typeof location === 'undefined' ? undefined : location
  return {
    landing: { pathname: page?.pathname ?? '', search: page?.search ?? '' },
    reload: () => { page?.reload() },
  }
}

/**
 * Register the sign-in card and the account row over one controller.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-auth: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new AuthController({
    call: (channel, endpoint, payload) => connection.rpc.call(channel, endpoint, payload),
    authRequired: connection.authRequired,
    ...pageAccess(),
  })
  const t = ctx.locale.bind(NS) as AuthTranslate
  const injected = (): ReturnType<AuthController['inject']> => controller.inject(t)

  ctx.effect(() => () => { controller.dispose() }, 'ui-auth: sign-in controller')
  // The first read decides everything the surfaces show, including whether
  // this deployment authenticates at all.
  void controller.start()

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'auth-gate',
    order: 0,
    locale: NS,
    inject: injected,
  }, AuthGateView))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'auth-account',
    order: 0,
    locale: NS,
    inject: injected,
  }, AccountIndicator))
}
