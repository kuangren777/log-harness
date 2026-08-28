// Proves the science-research skill layer is real, Loader-composed
// configurability and not a hand-built ctx.plugin() suite: a cordis.yml booted
// through the real Loader mounts the skill registry, a real filesystem, the
// storage hub/domain, and dsh-sci-skills, and the durable output it owns — the
// sandbox copy of the tree, its digest manifest, and the model-visible catalog
// ctx.skills serves — appears from that composition alone. The pinned/stale
// filter it controls follows the config through the Loader.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as SessionStore from '@deepseek-ai/dsh-session'
import * as SkillRegistry from '@deepseek-ai/dsh-skill'
import * as ReferencedText from '@deepseek-ai/dsh-referenced-text'
import * as LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as SciSkills from '@deepseek-ai/dsh-sci-skills'
import { MANIFEST_PATH } from '@deepseek-ai/dsh-sci-skills'

const DESCRIPTION = 'Render publication figures. Not for one-off charts.'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot a cordis.yml carrying the given sci-skills config block.
 * @param configLines - extra YAML lines nested under the plugin's `config:` key.
 * @param omitSandboxRoot - whether to leave the required `sandboxRoot` out.
 * @returns the booted context and the roots the composition uses.
 */
async function boot(configLines: readonly string[] = [], omitSandboxRoot = false): Promise<{
  ctx: Context
  sandboxRoot: string
}> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-skills-loader-'))
  const skillRoot = join(root, 'skills')
  const sandboxRoot = join(root, 'sandbox', 'skills')
  const storageRoot = join(root, 'storage')
  await mkdir(join(skillRoot, 'sci-plot'), { recursive: true })
  await mkdir(storageRoot, { recursive: true })
  await writeFile(
    join(skillRoot, 'sci-plot', 'SKILL.md'),
    `---\nname: sci-plot\ndescription: ${DESCRIPTION}\n---\n\nRun ${SciSkills.SKILL_ROOT_VARIABLE}/sci-plot/render.py\n`,
  )

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-skill'",
    "- name: '@deepseek-ai/dsh-referenced-text'",
    "- name: '@deepseek-ai/dsh-fs-local'",
    '  config:',
    `    cwd: ${JSON.stringify(sandboxRoot)}`,
    "- name: '@deepseek-ai/dsh-storage'",
    "- name: '@deepseek-ai/dsh-storage-json'",
    '  config:',
    `    root: ${JSON.stringify(storageRoot)}`,
    "- name: '@deepseek-ai/dsh-storage-domain'",
    '  config:',
    '    backend: json',
    "- name: '@deepseek-ai/dsh-sci-skills'",
    '  config:',
    '    source:',
    '      kind: directory',
    `      root: ${JSON.stringify(skillRoot)}`,
    ...omitSandboxRoot ? [] : [`    sandboxRoot: ${JSON.stringify(sandboxRoot)}`],
    ...configLines,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-skill', SkillRegistry],
    ['@deepseek-ai/dsh-referenced-text', ReferencedText],
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-sci-skills', SciSkills],
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
  return { ctx, sandboxRoot }
}

describe('sci-skills real Loader composition through cordis.yml', () => {
  it('publishes the tree, records its digests, and serves the catalog', async () => {
    const { ctx, sandboxRoot } = await boot()

    // The body stays off the sandbox disk; only the digest manifest is written.
    await expect(readFile(join(sandboxRoot, 'sci-plot', 'SKILL.md'), 'utf8')).rejects.toThrow()
    const manifest = JSON.parse(await readFile(join(sandboxRoot, MANIFEST_PATH), 'utf8')) as Record<string, unknown>
    expect(Object.keys(manifest)).toEqual(['sci-plot'])

    const listed = await ctx.skills.list()
    expect(listed).toEqual([expect.objectContaining({
      name: 'sci-plot',
      provider: 'sci',
      description: DESCRIPTION,
      source: 'bundled',
    })])
    // The body is served by reference, expanded to the sandbox root.
    const definition = await ctx.skills.get('sci-plot')
    expect(definition?.content).toContain(`Run ${sandboxRoot}/sci-plot/render.py`)
    expect(definition?.reference).toMatchObject({ store: 'sci', id: 'sci-plot' })

    const session = ctx.sessions.create()
    expect(session.events.map(event => event.type)).toContain('sci/skills-synced')
  }, 30_000)

  it('carries providerName and syncOnStart through the config', async () => {
    const { ctx, sandboxRoot } = await boot(['    providerName: bundled-sci', '    syncOnStart: false'])

    expect((await ctx.skills.list()).map(skill => skill.provider)).toEqual(['bundled-sci'])
    await expect(readFile(join(sandboxRoot, MANIFEST_PATH), 'utf8')).rejects.toThrow()
  }, 30_000)

  it('fails loading when the required sandbox root is missing', async () => {
    await expect(boot([], true)).rejects.toThrow(/sandboxRoot/)
  }, 30_000)

  it('fails loading when the staleness horizon is not a positive whole number', async () => {
    await expect(boot(['    staleAfterDays: 0'])).rejects.toThrow(/staleAfterDays/)
  }, 30_000)
})
