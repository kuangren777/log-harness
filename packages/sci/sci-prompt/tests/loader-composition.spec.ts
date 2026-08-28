// Proves the science-research prompt layer is real, Loader-composed configurability
// and not a hand-built ctx.plugin() unit: a cordis.yml booted through the real
// Loader mounts dsh-system-prompt + dsh-sci-prompt, and both model-visible
// surfaces it owns — the nine chapters as prompt sections and the four standing
// reminders as runtime context — appear in a genuine assembly. The
// includeProseReminder flag it controls follows the config through the Loader.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt, { renderContextSnapshot, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as SciPrompt from '@deepseek-ai/dsh-sci-prompt'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot a cordis.yml carrying the given sci-prompt config block.
 * @param configLines - YAML lines nested under the plugin's `config:` key.
 * @returns the booted context.
 */
async function boot(configLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-prompt-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-sci-prompt'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-sci-prompt', SciPrompt],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('sci-prompt real Loader composition through cordis.yml', () => {
  it('contributes the chapters and the standing reminders, prose reminder on by default', async () => {
    const ctx = await boot([])
    const assembly = await ctx.systemPrompt.assemble()

    const sectionNames = assembly.sections.map(section => section.name)
    expect(sectionNames).toContain('sci:reading-files')
    expect(sectionNames).toContain('sci:runtime-environment')

    const contextNames = assembly.contexts.map(context => context.name)
    expect(contextNames).toEqual([
      'sci:reminder:file',
      'sci:reminder:citation',
      'sci:reminder:prose',
      'sci:reminder:memory',
    ])

    const prompt = renderPrompt(assembly)
    // The Runtime environment chapter states what is TRUE in dsh: the workflow
    // call blocks until the run settles — the opposite of the studied platform's
    // stale "the completion notification never arrives" claim.
    expect(prompt).toContain('does not return until the whole run has settled')
    expect(prompt).not.toContain('never arrives')

    const snapshot = renderContextSnapshot(assembly)
    expect(snapshot).toContain('full spec in the "Prose first" section')
    expect(snapshot).toContain('full spec in the "Reading files" section')
  }, 30_000)

  it('includeProseReminder: false drops only the prose reminder, keeping the other three and the chapter', async () => {
    const ctx = await boot(['    includeProseReminder: false'])
    const assembly = await ctx.systemPrompt.assemble()

    expect(assembly.contexts.map(context => context.name)).toEqual([
      'sci:reminder:file',
      'sci:reminder:citation',
      'sci:reminder:memory',
    ])
    // The chapter always renders; only the every-turn reminder is gated.
    expect(assembly.sections.map(section => section.name)).toContain('sci:prose-first')
    expect(renderContextSnapshot(assembly)).not.toContain('Prose rule (full spec')
  }, 30_000)

  it('fails loading when includeProseReminder is not a boolean', async () => {
    await expect(boot(['    includeProseReminder: "no"'])).rejects.toThrow(/includeProseReminder/)
  }, 30_000)
})
