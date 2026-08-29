/**
 * CaMeL Science occupants for the generic browser-brand slots, plus the
 * profile's alias-token layer and motion base. Everything installs through
 * plugin-lifetime effects, so disposing the row restores the shipped brand,
 * the base palette, and the upstream motion curve together.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the theme plugin's Context merge (ctx.theme).
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import sciStyles from './sci.css?inline'
import { SciBrandMark, SciBrandName } from './Brand.tsx'
import { SCI_TOKENS, TOKEN_SOURCE } from './tokens.ts'

export { BRAND_NAME, SciBrandMark, SciBrandName } from './Brand.tsx'
export { SciLogo } from './SciLogo.tsx'
export { SCI_TOKENS, TOKEN_SOURCE } from './tokens.ts'

/** Required services: the UI slot registry and the theme runtime. */
export const inject = ['slots', 'theme']

/**
 * Mount the plugin-owned motion/type sheet for exactly this plugin's lifetime.
 * @param ctx - Client root context.
 */
function installSciStyles(ctx: ClientContext): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = TOKEN_SOURCE
    tag.dataset.pluginCss = `${TOKEN_SOURCE}/sci.css`
    tag.textContent = sciStyles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'ui-brand-sci: motion/type stylesheet')
}

/**
 * Fill every shipped brand slot as one declaration-aware registration set,
 * stack the CaMeL Science token layer, and mount the motion base.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  installSciStyles(ctx)
  ctx.effect(() => ctx.theme.overrideTokens(TOKEN_SOURCE, SCI_TOKENS), 'ui-brand-sci: theme token layer')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, SciBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, SciBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, SciBrandMark)
      })))
}
