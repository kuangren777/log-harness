/**
 * Access administration plugin, browser half. It registers one settings
 * section over the nine `auth.admin.*` wire methods: accounts, permission
 * groups, membership, and each group's rules.
 *
 * The section registers for everybody. What it renders depends on the gate's
 * own answer to `me`, and the Host refuses every administration call from a
 * non-administrator regardless, so a deployment that mounts no gate simply
 * shows an explained empty page.
 *
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { AccessSection } from './AccessSection.tsx'
import { AccessController } from './access-controller.ts'
import { en, zh, type AccessKey, type AccessTranslate } from './locales.ts'

export type { AccessSectionInjected, AccessSectionProps } from './AccessSection.tsx'
export type { AccessKey, AccessTranslate } from './locales.ts'
export type {
  AccessApi, AccessDeps, AccessFace, AccessGrant, AccessSessionSource, AccessState,
} from './access-controller.ts'
export type { AccessDomain, DomainAnalysis, DomainReach, NamePreview } from './rules.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Access administration page's copy. */
    'settings.access': AccessKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.access'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'sessions']

/**
 * Re-read the page only after it has been opened once: an unopened Access page
 * must not call the administration plane on a background reconnect.
 * @param controller - the page controller.
 */
export function refreshIfLoaded(controller: AccessController): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.refresh()
}

/**
 * Register the Access section once the `settings.section` declaration is on
 * the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-access: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const sessions = ctx.get('sessions') as ISessions
  const controller = new AccessController({
    api: connection.api,
    call: (channel, endpoint, payload) => connection.rpc.call(channel, endpoint, payload),
    sessions: sessions.list,
  })
  // Registration-time text (the nav label thunk) and the inject face share one
  // bound translate; copy freshness rides the locale revision.
  const t = ctx.locale.bind(NS) as AccessTranslate

  ctx.effect(
    () => ctx.on('connection/reset', () => { refreshIfLoaded(controller) }),
    'ui-settings-access: re-read after a reconnect',
  )

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'access',
    order: 30,
    label: () => t('nav'),
    inject: () => controller.inject(t),
  }, AccessSection))
}
