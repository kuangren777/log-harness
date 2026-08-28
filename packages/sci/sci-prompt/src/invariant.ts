/**
 * Package-owned prompt-assembly invariant for `@deepseek-ai/dsh-sci-prompt`.
 *
 * The relationship this asserts, over the authoritative `system-prompt/assemble`
 * waterfall result: every standing reminder this package contributes points the
 * model at the chapter that holds its full spec, so a reminder that survives
 * into an assembly whose chapter section has been removed or renamed is a
 * model-visible defect (a rule pointing at a section that is not there). For
 * each of this package's reminder contexts present in the assembly, the chapter
 * section it names must also be present. This is a data relationship between two
 * model-visible surfaces the package owns — its runtime-context reminders and
 * its prompt sections — not a check of service or registration presence.
 * @module @deepseek-ai/dsh-sci-prompt/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { REMINDER_CHAPTER_SECTIONS } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-prompt'

/** Cordis companion plugin name. */
export const name = 'sci-prompt-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Assert reminder-to-chapter pointer integrity for one assembled prompt.
 * @param assembly - the authoritative post-waterfall assembly.
 * @param fail - the package-attributed invariant reporter.
 */
function validateAssembly(assembly: PromptAssembly, fail: InvariantFailure): void {
  const sectionNames = new Set(assembly.sections.map(section => section.name))
  for (const context of assembly.contexts) {
    const chapter = REMINDER_CHAPTER_SECTIONS[context.name]
    if (chapter !== undefined && !sectionNames.has(chapter)) {
      fail(`standing reminder ${JSON.stringify(context.name)} points at chapter section ${JSON.stringify(chapter)}, which is absent from the assembled prompt`)
    }
  }
}

/** Install validation around the authoritative assembly waterfall result. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next()
    validateAssembly(assembled, fail)
    return assembled
  }, { global: true, prepend: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
