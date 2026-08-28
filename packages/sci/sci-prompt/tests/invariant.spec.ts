import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SciPrompt from '@deepseek-ai/dsh-sci-prompt'
import * as SciPromptInvariant from '@deepseek-ai/dsh-sci-prompt/invariant'

/**
 * Boot a context with the prompt registry, the invariant registry, and this
 * package's invariant companion.
 * @returns the composed context.
 */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(SciPromptInvariant)
  return ctx
}

describe('sci-prompt reminder-to-chapter pointer invariant', () => {
  it('accepts a coherent assembly where every reminder chapter is present', async () => {
    const ctx = await setup()
    await ctx.plugin(SciPrompt, { includeProseReminder: true })

    await expect(ctx.systemPrompt.assemble()).resolves.toBeDefined()
  })

  it('accepts an assembly with no sci reminders at all', async () => {
    const ctx = await setup()
    // An unrelated context with a name outside the reminder map is transparent.
    ctx.systemPrompt.context({ name: 'unrelated:policy', order: 1, text: 'policy' })

    await expect(ctx.systemPrompt.assemble()).resolves.toBeDefined()
  })

  it('rejects a standing reminder whose chapter section is absent', async () => {
    const ctx = await setup()
    // The reminder rides without the chapter it names — the exact drift the
    // invariant exists to catch (a rule pointing at a section that is gone).
    ctx.systemPrompt.context({ name: 'sci:reminder:file', order: 10, text: 'File rule …' })

    await expect(ctx.systemPrompt.assemble()).rejects.toThrow(
      /standing reminder "sci:reminder:file" points at chapter section "sci:reading-files", which is absent/,
    )
  })
})
