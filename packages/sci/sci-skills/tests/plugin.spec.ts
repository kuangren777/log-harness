// 07-T3 and the projection path: a skill whose frontmatter description is
// empty fails the LOAD by name rather than reaching a catalog; a recorded
// skill-tool call ages the tree; disposing the fiber removes the provider.
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { AddressInfo } from 'node:net'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, LoggerLevel } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm/brand'
import SessionStore from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import ReferencedText from '@deepseek-ai/dsh-referenced-text'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as SciSkills from '@deepseek-ai/dsh-sci-skills'
import { LIFECYCLE_TABLE, MANIFEST_PATH, USAGE_TABLE, sciSkillsDomainSpec } from '@deepseek-ai/dsh-sci-skills'
import type { SkillLifecycleRecord, SkillUsageRecord } from '@deepseek-ai/dsh-sci-skills'

const DESCRIPTION = 'Render figures. Not for one-off charts.'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Lay out a host skill tree plus empty storage and sandbox roots.
 * @param skills - SKILL.md content keyed by skill directory name.
 * @returns the three absolute roots.
 */
async function layout(skills: Record<string, string>): Promise<{
  skillRoot: string
  sandboxRoot: string
  storageRoot: string
}> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-skills-'))
  const skillRoot = join(root, 'skills')
  for (const [name, content] of Object.entries(skills)) {
    await mkdir(join(skillRoot, name), { recursive: true })
    await writeFile(join(skillRoot, name, 'SKILL.md'), content)
  }
  await mkdir(join(root, 'sandbox'), { recursive: true })
  await mkdir(join(root, 'storage'), { recursive: true })
  return { skillRoot, sandboxRoot: join(root, 'sandbox', 'skills'), storageRoot: join(root, 'storage') }
}

/**
 * Resolve a complete config from the two roots plus overrides. The Loader
 * composition suite covers the schema defaults; this one states them so the
 * plugin call is type-checked against the resolved config it receives.
 * @param roots - the skill and sandbox roots.
 * @param config - fields differing from the defaults.
 * @returns the complete config.
 */
function fullConfig(
  roots: { skillRoot: string; sandboxRoot: string },
  config: Partial<SciSkills.Config> = {},
): SciSkills.Config {
  return {
    source: {
      kind: 'directory',
      root: roots.skillRoot,
      url: '',
      tokenEnv: 'SCI_VAULT_TOKEN',
      timeoutMs: 10_000,
    },
    sandboxRoot: roots.sandboxRoot,
    staleAfterDays: 90,
    pinned: [],
    syncOnStart: true,
    skillToolName: 'skill',
    providerName: 'sci',
    ...config,
  }
}

/**
 * Compose the plugin over real session, skill, filesystem, and storage plugins.
 * @param skills - SKILL.md content keyed by skill directory name.
 * @param config - sci-skills config beyond the two roots.
 * @returns the context, the plugin fiber, and the roots.
 */
async function boot(
  skills: Record<string, string>,
  config: Partial<SciSkills.Config> = {},
) {
  const roots = await layout(skills)
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SessionStore)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(ReferencedText)
  await ctx.plugin(LocalFileSystem, { cwd: roots.sandboxRoot })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: roots.storageRoot })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const fiber = await ctx.plugin(SciSkills, fullConfig(roots, config))
  return { ctx, fiber, ...roots }
}

/**
 * Build a SKILL.md.
 * @param name - the skill name, which must match its directory.
 * @param description - the frontmatter description.
 * @param body - the instruction body.
 * @returns the file content.
 */
function skillFile(name: string, description: string, body = 'Body.'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`
}

/**
 * Collect every warning the context logs from now on.
 * @param ctx - the context whose logger service is observed.
 * @returns the growing list of formatted first arguments.
 */
function warnings(ctx: Context): string[] {
  const collected: string[] = []
  ctx.logger.exporter({
    levels: { default: LoggerLevel.DEBUG },
    export: (message) => {
      if (message.type === 'warn') collected.push(String(message.args[0]))
    },
  })
  return collected
}

describe('sci-skills load-time validation', () => {
  it('throws naming the skill whose description is empty', async () => {
    await expect(boot({ 'sci-plot': '---\nname: sci-plot\ndescription: ""\n---\n\nBody.\n' }))
      .rejects.toThrow(/skill "sci-plot" has an empty SKILL.md frontmatter description/)
  })

  it('throws naming the skill whose description is missing outright', async () => {
    await expect(boot({ 'sci-plot': '---\nname: sci-plot\n---\n\nBody.\n' }))
      .rejects.toThrow(/skill "sci-plot" has an empty SKILL.md frontmatter description/)
  })

  it('throws naming a directory with no SKILL.md', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-sci-skills-'))
    await mkdir(join(root, 'skills', 'sci-plot'), { recursive: true })
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SessionStore)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ReferencedText)
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })

    await expect(ctx.plugin(SciSkills, fullConfig({
      skillRoot: join(root, 'skills'),
      sandboxRoot: join(root, 'sandbox'),
    }))).rejects.toThrow(/skill directory "sci-plot" has no SKILL.md/)
  })

  it('rejects a config without a sandbox root', async () => {
    await layout({ 'sci-plot': skillFile('sci-plot', DESCRIPTION) })
    const ctx = new Context()
    context = ctx

    expect(() => SciSkills.Config({ source: { kind: 'directory' } } as never)).toThrow(/sandboxRoot/)
  })
})

describe('sci-skills composition', () => {
  it('lists the catalog and serves the body by reference, keeping SKILL.md off the sandbox', async () => {
    const { ctx, sandboxRoot } = await boot({
      'sci-plot': skillFile('sci-plot', DESCRIPTION, `Run ${SciSkills.SKILL_ROOT_VARIABLE}/sci-plot/render.py`),
    })

    // The body is a platform secret: it is never written to the sandbox disk.
    await expect(readFile(join(sandboxRoot, 'sci-plot', 'SKILL.md'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(sandboxRoot, MANIFEST_PATH), 'utf8')).resolves.toContain('sci-plot')

    const listed = await ctx.skills.list()
    expect(listed.map(skill => [skill.name, skill.provider, skill.description]))
      .toEqual([['sci-plot', 'sci', DESCRIPTION]])
    const definition = await ctx.skills.get('sci-plot')
    // The body reaches the model with the sandbox root expanded, and carries a
    // content-addressed reference the request path resolves.
    expect(definition?.content).toContain(`${sandboxRoot}/sci-plot/render.py`)
    expect(definition?.reference).toMatchObject({ store: 'sci', id: 'sci-plot' })
  })

  it('syncs the non-SKILL.md files into the sandbox and excludes the body', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-sci-skills-'))
    const skillRoot = join(root, 'skills')
    await mkdir(join(skillRoot, 'sci-plot'), { recursive: true })
    await writeFile(join(skillRoot, 'sci-plot', 'SKILL.md'), skillFile('sci-plot', DESCRIPTION))
    await writeFile(join(skillRoot, 'sci-plot', 'helper.txt'), 'shared asset')
    const sandboxRoot = join(root, 'sandbox', 'skills')
    await mkdir(join(root, 'storage'), { recursive: true })
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SessionStore)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ReferencedText)
    await ctx.plugin(LocalFileSystem, { cwd: sandboxRoot })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: join(root, 'storage') })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(SciSkills, fullConfig({ skillRoot, sandboxRoot }))

    await expect(readFile(join(sandboxRoot, 'sci-plot', 'helper.txt'), 'utf8')).resolves.toBe('shared asset')
    await expect(readFile(join(sandboxRoot, 'sci-plot', 'SKILL.md'), 'utf8')).rejects.toThrow()
  })

  // B2: `.sci/skills.json` is inside the sandbox, so the model can write it.
  it('drops a sandbox manifest key that would escape the skill root and warns', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-sci-skills-'))
    const skillRoot = join(root, 'skills')
    await mkdir(join(skillRoot, 'sci-plot'), { recursive: true })
    await writeFile(join(skillRoot, 'sci-plot', 'SKILL.md'), skillFile('sci-plot', DESCRIPTION))
    const sandboxRoot = join(root, 'sandbox', 'skills')
    await mkdir(join(sandboxRoot, '.sci'), { recursive: true })
    await writeFile(
      join(sandboxRoot, MANIFEST_PATH),
      '{"sci-plot":{"hash":"x","files":{"../../../../etc/hosts":"deadbeef","SKILL.md":"deadbeef"}}}',
    )
    const ctx = new Context()
    context = ctx
    const logged = warnings(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ReferencedText)
    await ctx.plugin(LocalFileSystem, { cwd: sandboxRoot })
    await mkdir(join(root, 'storage'), { recursive: true })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: join(root, 'storage') })
    await ctx.plugin(StorageDomain, { backend: 'json' })

    await ctx.plugin(SciSkills, fullConfig({ skillRoot, sandboxRoot }))

    expect(logged).toContain('sci-skills ignored sandbox manifest entry "sci-plot/../../../../etc/hosts": the file key contains a ".." segment')
    const written: unknown = JSON.parse(await readFile(join(sandboxRoot, MANIFEST_PATH), 'utf8'))
    expect(Object.keys((written as { 'sci-plot': { files: Record<string, string> } })['sci-plot'].files))
      .toEqual(['SKILL.md'])
  })

  it('records the sync round into every session opened after it', async () => {
    const { ctx } = await boot({ 'sci-plot': skillFile('sci-plot', DESCRIPTION) })

    const session = ctx.sessions.create()

    // The body is excluded from the sandbox sync, and this skill ships no other
    // file, so the round writes nothing while still recording that it ran.
    expect(session.events.filter(event => event.type === 'sci/skills-synced').map(event => event.data))
      .toEqual([{ changed: [], removed: [] }])
    // Informational: a build without this plugin must skip the record, not refuse the log.
    expect(session.events.filter(event => event.type === 'sci/skills-synced').map(event => event.ignorable))
      .toEqual([true])
  })

  it('skips the sandbox round and the session record when syncOnStart is off', async () => {
    const { ctx, sandboxRoot } = await boot(
      { 'sci-plot': skillFile('sci-plot', DESCRIPTION) },
      { syncOnStart: false },
    )

    const session = ctx.sessions.create()

    expect(session.events.some(event => event.type === 'sci/skills-synced')).toBe(false)
    await expect(readFile(join(sandboxRoot, MANIFEST_PATH), 'utf8')).rejects.toThrow()
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['sci-plot'])
  })

  it('projects a recorded skill-tool call into the usage and lifecycle tables', async () => {
    const { ctx } = await boot({
      'sci-plot': skillFile('sci-plot', DESCRIPTION),
      'sci-paper': skillFile('sci-paper', DESCRIPTION),
    })
    const session = ctx.sessions.create()

    for (const args of ['{"name":"sci-plot"}', '{"name":"not-a-skill"}', 'not json']) {
      session.append('tool/call', { turn: 1, step: 1, callId: CallId('c1'), name: 'skill', arguments: args })
    }
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c2'), name: 'read', arguments: '{"name":"sci-paper"}' })

    const domain = ctx.storageDomain.get(sciSkillsDomainSpec.name)!
    const usage = domain.table(USAGE_TABLE) as unknown as { get(key: string): SkillUsageRecord | undefined }
    const lifecycle = domain.table(LIFECYCLE_TABLE) as unknown as { get(key: string): SkillLifecycleRecord | undefined }
    await expect.poll(() => usage.get('sci-plot')?.count).toBe(1)
    expect(usage.get('sci-paper')).toBeUndefined()
    expect(usage.get('not-a-skill')).toBeUndefined()
    expect(lifecycle.get('sci-plot')).toMatchObject({ state: 'active', pinned: false })
  })

  // M5: `session/event` is synchronous, so both listener calls run before
  // either stored row is read back.
  it('counts two skill loads recorded in the same tick', async () => {
    const { ctx } = await boot({ 'sci-plot': skillFile('sci-plot', DESCRIPTION) })
    const session = ctx.sessions.create()

    for (const callId of ['c1', 'c2']) {
      session.append('tool/call', { turn: 1, step: 1, callId: CallId(callId), name: 'skill', arguments: '{"name":"sci-plot"}' })
    }

    const usage = ctx.storageDomain.get(sciSkillsDomainSpec.name)!
      .table(USAGE_TABLE) as unknown as { get(key: string): SkillUsageRecord | undefined }
    await expect.poll(() => usage.get('sci-plot')?.count).toBe(2)
  })

  it('logs a usage recording that failed instead of rejecting', async () => {
    const { ctx } = await boot({ 'sci-plot': skillFile('sci-plot', DESCRIPTION) })
    const logged = warnings(ctx)
    await ctx.storageDomain.get(sciSkillsDomainSpec.name)!.close()
    const session = ctx.sessions.create()

    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c1'), name: 'skill', arguments: '{"name":"sci-plot"}' })

    await expect.poll(() => logged.find(message => message.startsWith('sci-skills could not record the load of skill "sci-plot"')))
      .toMatch(/is closed/)
  })

  it('counts calls to the configured tool name only', async () => {
    const { ctx } = await boot(
      { 'sci-plot': skillFile('sci-plot', DESCRIPTION) },
      { skillToolName: 'load_skill' },
    )
    const session = ctx.sessions.create()

    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c1'), name: 'skill', arguments: '{"name":"sci-plot"}' })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c2'), name: 'load_skill', arguments: '{"name":"sci-plot"}' })

    const usage = ctx.storageDomain.get(sciSkillsDomainSpec.name)!
      .table(USAGE_TABLE) as unknown as { get(key: string): SkillUsageRecord | undefined }
    await expect.poll(() => usage.get('sci-plot')?.count).toBe(1)
  })

  it('marks the configured pinned skills exempt from ageing', async () => {
    const { ctx } = await boot(
      { 'sci-plot': skillFile('sci-plot', DESCRIPTION) },
      { pinned: ['sci-plot'] },
    )

    const lifecycle = ctx.storageDomain.get(sciSkillsDomainSpec.name)!
      .table(LIFECYCLE_TABLE) as unknown as { get(key: string): SkillLifecycleRecord | undefined }
    expect(lifecycle.get('sci-plot')).toMatchObject({ pinned: true, state: 'active' })
  })

  it('removes the provider and closes the domain when the fiber is disposed', async () => {
    const { ctx, fiber } = await boot({ 'sci-plot': skillFile('sci-plot', DESCRIPTION) })
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['sci-plot'])

    await fiber.dispose()

    expect(await ctx.skills.list()).toEqual([])
    expect(ctx.storageDomain.get(sciSkillsDomainSpec.name)).toBeUndefined()
  })

  it('resolves a body through the referenced-text store and rejects an unknown one', async () => {
    const { ctx, sandboxRoot } = await boot({
      'sci-plot': skillFile('sci-plot', DESCRIPTION, `Run ${SciSkills.SKILL_ROOT_VARIABLE}/sci-plot/render.py`),
    })
    // The store returns the expanded body; the registry verifies its digest, so
    // the reference must carry the digest of the expanded text.
    const expanded = `Run ${sandboxRoot}/sci-plot/render.py`
    const digest = createHash('sha256').update(expanded, 'utf8').digest('hex')

    await expect(ctx.referencedText.read({ store: 'sci', id: 'sci-plot', sha256: digest }))
      .resolves.toContain(`${sandboxRoot}/sci-plot/render.py`)
    await expect(ctx.referencedText.read({ store: 'sci', id: 'absent', sha256: '0'.repeat(64) }))
      .rejects.toThrow(/unknown skill "absent"/)
  })

  it('serves the current body for a reference whose digest is outdated', async () => {
    const { ctx } = await boot({
      'sci-plot': skillFile('sci-plot', DESCRIPTION, 'Current body.'),
    })
    await expect(ctx.referencedText.read({ store: 'sci', id: 'sci-plot', sha256: '0'.repeat(64) }))
      .resolves.toBe('Current body.')
  })

  it('falls back to the recorded body for a skill absent from the catalog', async () => {
    const body = 'Retired body.'
    const { ctx } = await boot({
      'sci-plot': skillFile('sci-plot', DESCRIPTION, 'Retired body.'),
    })
    const digest = createHash('sha256').update(body, 'utf8').digest('hex')
    await expect(ctx.referencedText.read({ store: 'sci', id: 'sci-gone', sha256: digest }))
      .resolves.toBe(body)
  })
})

describe('sci-skills http source', () => {
  const TOKEN_ENV = 'SCI_VAULT_TOKEN'
  let httpServer: import('node:http').Server | undefined

  afterEach(async () => {
    delete process.env.SCI_VAULT_TOKEN
    if (httpServer !== undefined) await new Promise<void>(resolve => httpServer!.close(() => { resolve() }))
    httpServer = undefined
  })

  /**
   * Boot sci-skills against an in-process HTTP vault stub.
   * @param handler - the stub's per-path responder.
   * @param overrides - config fields beyond the http source.
   * @returns the context and the stub's base URL.
   */
  async function bootHttp(
    handler: (path: string) => { status: number; body: string },
    overrides: Partial<SciSkills.Config> = {},
  ): Promise<{ ctx: Context; url: string }> {
    root = await mkdtemp(join(tmpdir(), 'dsh-sci-skills-http-'))
    const sandboxRoot = join(root, 'sandbox', 'skills')
    const storageRoot = join(root, 'storage')
    await mkdir(sandboxRoot, { recursive: true })
    await mkdir(storageRoot, { recursive: true })
    const server = createServer((req, res) => {
      const { status, body } = handler(req.url ?? '')
      res.writeHead(status)
      res.end(body)
    })
    httpServer = server
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => { resolve() }))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SessionStore)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ReferencedText)
    await ctx.plugin(LocalFileSystem, { cwd: sandboxRoot })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: storageRoot })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(SciSkills, fullConfig({ skillRoot: '', sandboxRoot }, {
      source: { kind: 'http', root: '', url, tokenEnv: TOKEN_ENV, timeoutMs: 10_000 },
      ...overrides,
    }))
    return { ctx, url }
  }

  const entry = (bodySha256: string) => JSON.stringify({
    skills: [{ name: 'sci-plot', description: DESCRIPTION, invocation: { modelInvocable: true, userInvocable: true }, bodySha256, files: {} }],
  })

  it('lists the catalog and serves the body from the vault', async () => {
    process.env[TOKEN_ENV] = 'vm-token'
    const bodySha256 = createHash('sha256').update('BODY', 'utf8').digest('hex')
    const { ctx } = await bootHttp((path) => {
      if (path === '/v1/catalog') return { status: 200, body: entry(bodySha256) }
      if (path === `/v1/objects/${bodySha256}`) return { status: 200, body: 'BODY' }
      return { status: 404, body: 'no' }
    })

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['sci-plot'])
    expect((await ctx.skills.get('sci-plot'))?.content).toBe('BODY')
  })

  it('fails the load when the token env var is absent', async () => {
    await expect(bootHttp(() => ({ status: 200, body: entry('x') })))
      .rejects.toThrow(/requires the SCI_VAULT_TOKEN environment variable/)
  })

  it('fails the load on an unknown source kind', async () => {
    const roots = await layout({ 'sci-plot': skillFile('sci-plot', DESCRIPTION) })
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SessionStore)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ReferencedText)
    await ctx.plugin(LocalFileSystem, { cwd: roots.sandboxRoot })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: roots.storageRoot })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await expect(ctx.plugin(SciSkills, fullConfig(roots, {
      source: { kind: 'bogus', root: roots.skillRoot, url: '', tokenEnv: TOKEN_ENV, timeoutMs: 10_000 },
    }))).rejects.toThrow(/unknown source.kind "bogus"/)
  })

  it('fails the load when a directory source omits its root', async () => {
    const roots = await layout({ 'sci-plot': skillFile('sci-plot', DESCRIPTION) })
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SessionStore)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ReferencedText)
    await ctx.plugin(LocalFileSystem, { cwd: roots.sandboxRoot })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: roots.storageRoot })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await expect(ctx.plugin(SciSkills, fullConfig(roots, {
      source: { kind: 'directory', root: '', url: '', tokenEnv: TOKEN_ENV, timeoutMs: 10_000 },
    }))).rejects.toThrow(/source.kind "directory" requires source.root/)
  })

  it('fails the load when the http source omits its url', async () => {
    process.env[TOKEN_ENV] = 'vm-token'
    const roots = await layout({ 'sci-plot': skillFile('sci-plot', DESCRIPTION) })
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SessionStore)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ReferencedText)
    await ctx.plugin(LocalFileSystem, { cwd: roots.sandboxRoot })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: roots.storageRoot })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await expect(ctx.plugin(SciSkills, fullConfig(roots, {
      source: { kind: 'http', root: '', url: '', tokenEnv: TOKEN_ENV, timeoutMs: 10_000 },
    }))).rejects.toThrow(/source.kind "http" requires source.url/)
  })

  it('fails the load when a served skill has an empty description', async () => {
    process.env[TOKEN_ENV] = 'vm-token'
    await expect(bootHttp(() => ({
      status: 200,
      body: JSON.stringify({ skills: [{ name: 'sci-plot', description: '  ', invocation: { modelInvocable: true, userInvocable: true }, bodySha256: 'x', files: {} }] }),
    }))).rejects.toThrow(/skill "sci-plot" has an empty description/)
  })
})
