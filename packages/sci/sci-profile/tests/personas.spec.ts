import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { PERSONA_NAMES } from '@deepseek-ai/dsh-sci-plan'
import { subagentToolName } from '@deepseek-ai/dsh-sci-tier'
import type { PersonaName } from '@deepseek-ai/dsh-sci-plan'
import * as SciProfile from '../src/index.ts'
import * as SciProfileInvariant from '../src/invariant.ts'

const disposers: (() => Promise<void>)[] = []
const workdirs: string[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  for (const dir of workdirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A charter directory holding the six shipped documents, minus and plus what a case asks for. */
function charterDir(overrides: Readonly<Record<string, string | undefined>> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sci-personas-'))
  workdirs.push(dir)
  for (const name of PERSONA_NAMES) {
    const override = Object.hasOwn(overrides, name) ? overrides[name] : undefined
    if (Object.hasOwn(overrides, name) && override === undefined) continue
    writeFileSync(join(dir, `${name}.md`), override ?? `---\nname: ${name}\nsummary: ${name} summary.\n---\n${name} charter.\n`)
  }
  for (const [name, body] of Object.entries(overrides)) {
    if ((PERSONA_NAMES as readonly string[]).includes(name) || body === undefined) continue
    writeFileSync(join(dir, `${name}.md`), body)
  }
  return dir
}

/** A context carrying the prompt registry and this package's invariant companion. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(SciProfileInvariant)
  disposers.push(async () => { await ctx.fiber.dispose() })
  return ctx
}

describe('loadPersonas', () => {
  it('reads the six charters this package ships, in declaration order', () => {
    const personas = SciProfile.loadPersonas(SciProfile.BUNDLED_AGENTS_ROOT)

    expect(personas.map(persona => persona.name)).toEqual([...PERSONA_NAMES])
    for (const persona of personas) {
      expect(persona.summary.length, persona.name).toBeGreaterThan(0)
      expect(persona.charter.length, persona.name).toBeGreaterThan(0)
    }
  })

  it('ships card copy for every persona the browser roster draws', () => {
    // The agent view reads `display` and falls back to the English charter
    // fields when a document declares none; the SHIPPED tree must never make it
    // fall back, or six English one-liners would reach a Chinese product page.
    for (const persona of SciProfile.loadPersonas(SciProfile.BUNDLED_AGENTS_ROOT)) {
      expect(persona.display, persona.name).toBeDefined()
      expect(persona.display?.name.length, persona.name).toBeGreaterThan(0)
      expect(persona.display?.role.length, persona.name).toBeGreaterThan(0)
      expect(persona.display?.description.length, persona.name).toBeGreaterThan(0)
    }
  })

  it('gives plotter and deliverer the exclusive charter the profile promises', () => {
    const personas = SciProfile.loadPersonas(SciProfile.BUNDLED_AGENTS_ROOT)
    const by = new Map(personas.map(persona => [persona.name, persona.charter]))

    expect(by.get('plotter')).toMatch(/only persona that runs the sciplot render path/)
    expect(by.get('deliverer')).toMatch(/only persona that copies work into the delivery workspace/)
    for (const name of ['researcher', 'adversary', 'scout', 'writer'] satisfies PersonaName[]) {
      expect(by.get(name), name).toMatch(/[Dd]o not render figures/)
      expect(by.get(name), name).toMatch(/do not deliver files|Do not deliver files/)
    }
  })

  it('ignores files that are not charter documents', () => {
    const dir = charterDir()
    writeFileSync(join(dir, 'README.txt'), 'not a charter')

    expect(SciProfile.loadPersonas(dir).map(persona => persona.name)).toEqual([...PERSONA_NAMES])
  })

  it('names the directory it could not read', () => {
    const missing = join(tmpdir(), 'dsh-sci-personas-absent', 'agents')

    expect(() => SciProfile.loadPersonas(missing)).toThrow(/cannot read the persona directory/)
  })

  it('refuses a roster with a charter removed', () => {
    expect(() => SciProfile.loadPersonas(charterDir({ plotter: undefined })))
      .toThrow(/the persona roster is missing "plotter"/)
  })

  it('refuses a malformed charter, naming the file', () => {
    const dir = charterDir({ scout: 'no frontmatter here\n' })

    expect(() => SciProfile.loadPersonas(dir)).toThrow(/scout\.md must open with a "---" frontmatter block/)
  })
})

describe('the sci-profile plugin', () => {
  it('assembles the roster as one section between orchestration and irreversible actions', async () => {
    const ctx = await setup()
    await ctx.plugin(SciProfile, { agentsRoot: SciProfile.BUNDLED_AGENTS_ROOT })

    const assembled = await ctx.systemPrompt.assemble()
    const text = JSON.stringify(assembled)
    expect(text).toContain(SciProfile.SECTION_PERSONAS)
    // The roster heading now names the tool the persona is mounted behind.
    for (const name of PERSONA_NAMES) expect(text, name).toContain(`### ${name} \u2014 \`${subagentToolName(name)}\``)
  })

  it('defaults to the charters shipped inside this package', async () => {
    const ctx = await setup()
    await ctx.plugin(SciProfile, { agentsRoot: SciProfile.BUNDLED_AGENTS_ROOT })

    expect(JSON.stringify(await ctx.systemPrompt.assemble())).toContain('only persona that runs the sciplot render path')
  })

  it('removes the section with the fiber', async () => {
    const ctx = await setup()
    const fiber = await ctx.plugin(SciProfile, { agentsRoot: SciProfile.BUNDLED_AGENTS_ROOT })
    expect(JSON.stringify(await ctx.systemPrompt.assemble())).toContain(SciProfile.SECTION_PERSONAS)

    await fiber.dispose()

    expect(JSON.stringify(await ctx.systemPrompt.assemble())).not.toContain(SciProfile.SECTION_PERSONAS)
  })

  it('fails to load against a charter directory that is not a complete roster', async () => {
    const ctx = await setup()

    await expect(ctx.plugin(SciProfile, { agentsRoot: charterDir({ writer: undefined }) }))
      .rejects.toThrow(/the persona roster is missing "writer"/)
  })

  it('names the two presets the bundle ships', () => {
    expect(SciProfile.SCI_PRESETS).toEqual(['sci-balanced', 'sci-cluster'])
    expect(SciProfile.BUNDLED_PRESET_ROOT.endsWith('agent-presets')).toBe(true)
  })
})
