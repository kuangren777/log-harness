/**
 * Skills settings plugin, browser half. It registers the Skills page: the
 * discovered skill inventory for the current session's project, and the two
 * invocation surfaces a user may override per skill. Discovery is cwd-scoped,
 * so the page is addressed by the current session and re-reads whenever the
 * Host announces a catalog change, a write settles, or the connection resets.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry)
// and the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (the skill registry's `skills/change` rides the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { SkillsSection } from './SkillsSection.tsx'
import {
  SKILLS_SETTINGS_NS, SkillsSectionController, type SkillPolicyOverrides,
} from './skills-controller.ts'
import { en, zh, type SkillsKey, type SkillsTranslate } from './locales.ts'

export type { SkillsSectionInjected, SkillsSectionProps } from './SkillsSection.tsx'
export type { SkillsKey, SkillsTranslate } from './locales.ts'
export type { SkillsSectionFace, SkillsSectionState, SkillPolicyOverrides } from './skills-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Skills page's copy. */
    'settings.skills': SkillsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.skills'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'sessions', 'remote', 'settingsScope']

/**
 * Refetch the page snapshot only after its first load: an unopened Skills page
 * must not fetch on background invalidations.
 * @param controller - the page store.
 */
export function refreshIfLoaded(controller: SkillsSectionController): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.refresh()
}

/**
 * Register the Skills section once the `settings.section` declaration is on
 * the ledger, and keep it fresh on every pushed catalog invalidation.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-skills: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const sessions = ctx.get('sessions') as ISessions
  const controller = new SkillsSectionController(
    connection.api,
    sessions.list,
    ctx.settingsScope.bind<SkillPolicyOverrides>({ namespace: SKILLS_SETTINGS_NS }),
    connection.hostDescription,
  )
  // Registration-time text (the nav label thunk) and the inject face share one
  // bound translate; copy freshness rides the locale revision.
  const t = ctx.locale.bind(NS) as SkillsTranslate

  ctx.effect(() => {
    const refresh = (): void => { refreshIfLoaded(controller) }
    const disposers = [
      ctx.remote.$on('skills/change', refresh),
      ctx.on('connection/reset', refresh),
    ]
    return () => {
      controller.dispose()
      for (const dispose of disposers) dispose()
    }
  }, 'ui-settings-skills: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skills',
    order: 12,
    label: () => t('nav'),
    inject: () => controller.inject(t),
  }, SkillsSection))
}
