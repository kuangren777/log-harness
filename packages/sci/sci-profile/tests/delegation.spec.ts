/**
 * The six persona-bound delegation tools of the `sci-cluster` preset.
 *
 * Two relations are asserted here. The first is the mirror: every `persona:`
 * block in the preset is the body of the charter document it names, which is
 * what lets the composition restate a charter it cannot read at load — a
 * preset subtree has no file access, and a drifted block would hand a child a
 * charter no one reviewed. The second is the composition itself: the same rows,
 * booted through the real Loader, register the six tools and hand each child
 * its own charter, which is the whole reason the preset mounts the package six
 * times instead of once.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dump } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { CallId } from '@deepseek-ai/dsh-llm'
import { PERSONA_NAMES } from '@deepseek-ai/dsh-sci-plan'
import { subagentToolName } from '@deepseek-ai/dsh-sci-tier'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import { BUNDLED_AGENTS_ROOT, loadPersonas } from '../src/index.ts'
import { balancedPreset, clusterPreset, flattenRows } from './harness.ts'

const SIGNAL = new AbortController().signal

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** One mounted `tool-subagent` row's config, as the preset declares it. */
interface DelegationConfig {
  provider?: unknown
  toolName?: unknown
  backgroundMode?: unknown
  persona?: unknown
  toolFilter?: unknown
}

/** Every `@deepseek-ai/dsh-tool-subagent` row of the cluster preset, in declaration order. */
function delegationRows(): EntryOptions[] {
  return flattenRows(clusterPreset()).filter(row => row.name === '@deepseek-ai/dsh-tool-subagent')
}

/** One row's config, narrowed to the fields this suite reads. */
function configOf(row: EntryOptions): DelegationConfig {
  return (row.config ?? {}) as DelegationConfig
}

/** The named preset's `fanoutTools` list. */
function fanoutTools(entries: readonly EntryOptions[]): string[] {
  const row = flattenRows(entries).find(entry => entry.id === 'sci-tier')
  return (configOf(row as EntryOptions) as unknown as { fanoutTools: string[] }).fanoutTools
}

describe('the sci-cluster delegation rows', () => {
  it('mounts one tool-subagent row per persona and no unbound one', () => {
    const rows = delegationRows()

    expect(rows.map(row => row.id)).toEqual(PERSONA_NAMES.map(name => `tool-subagent-${name}`))
    expect(rows.map(row => configOf(row).toolName)).toEqual(PERSONA_NAMES.map(subagentToolName))
    for (const row of rows) {
      expect(configOf(row).provider, row.id).toBe('spawn')
      // Continuable, so the calling thread gets a durable child id back and can
      // send the child a later turn instead of restarting the persona.
      expect(configOf(row).backgroundMode, row.id).toBe('continuable')
    }
  })

  it('restates each charter exactly as its document, with no frontmatter', () => {
    const charters = new Map(loadPersonas(BUNDLED_AGENTS_ROOT).map(persona => [persona.name, persona.charter]))

    for (const [index, name] of PERSONA_NAMES.entries()) {
      expect(configOf(delegationRows()[index] as EntryOptions).persona, name).toBe(charters.get(name))
    }
  })

  it('carries the static toolFilter each charter declares, which today is none', () => {
    const personas = loadPersonas(BUNDLED_AGENTS_ROOT)

    for (const [index, persona] of personas.entries()) {
      const declared = persona.deny === undefined ? undefined : { deny: [...persona.deny] }
      expect(configOf(delegationRows()[index] as EntryOptions).toolFilter, persona.name).toEqual(declared)
    }
  })

  it('gates every persona tool at both tiers', () => {
    const names = PERSONA_NAMES.map(subagentToolName)

    for (const [label, entries] of [['sci-cluster', clusterPreset()], ['sci-balanced', balancedPreset()]] as const) {
      for (const name of names) expect(fanoutTools(entries), `${label}: ${name}`).toContain(name)
    }
  })
})

/** A parent agent carrying only what the delegation path reads off it. */
function fakeAgent(): Agent {
  return { id: SessionId('sci-profile-delegation') } as unknown as Agent
}

/** The persona each started child was composed with, keyed by the tool that started it. */
type StartedPersonas = Map<string, string | undefined>

/**
 * Boot the preset's six delegation rows through the real Loader over a scripted
 * child boundary.
 * @param started - filled with the persona each start request carried.
 * @returns the booted context.
 */
async function boot(started: StartedPersonas): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-profile-delegation-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, dump([
    { name: '@deepseek-ai/dsh-system-prompt' },
    { name: '@deepseek-ai/dsh-tools' },
    { name: '@deepseek-ai/dsh-subagent' },
    { name: 'scripted-provider' },
    ...delegationRows().map(row => ({ id: row.id, name: row.name, config: configOf(row) })),
  ]))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const provider = {
    name: 'scripted-provider',
    inject: ['subagents'],
    apply(pluginCtx: Context): void {
      pluginCtx.subagents.registerProvider({
        name: 'spawn',
        // `depthLimit` because the rows leave `maxDepth` at the package default,
        // which a provider that cannot enforce it refuses at mount — the same
        // check the shipped `spawn` backend passes.
        capabilities: { outputSchema: false, depthLimit: true, toolFilter: true, persona: true },
        inheritsParentContext: false,
        start: (request: SubagentStartRequest): Promise<SubagentRun> => {
          started.set(request.label ?? '', request.persona)
          return Promise.resolve({
            id: SessionId(`scripted:${request.label ?? ''}`),
            localAgent: undefined,
            result: Promise.resolve({
              output: [{ type: 'text' as const, text: 'scripted reply' }],
              stopReason: 'completed' as const,
            }),
            dispose: () => Promise.resolve(),
          })
        },
        prepareContinuable: () => Promise.resolve({}),
      })
    },
  }
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-subagent', SubagentRuntime],
    ['@deepseek-ai/dsh-tool-subagent', ToolSubagent],
    ['scripted-provider', provider],
  ])
  ctx.loader.internal = {
    version: 'v2',
    import(specifier: string): Promise<unknown> {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return Promise.resolve(modules.get(specifier))
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('the sci-cluster delegation rows through the real Loader', () => {
  it('registers the six persona tools and no unbound subagent', async () => {
    const ctx = await boot(new Map())

    const names = ctx.tools.schemas().map(schema => schema.name)

    for (const name of PERSONA_NAMES.map(subagentToolName)) expect(names, name).toContain(name)
    expect(names).not.toContain('subagent')
  }, 30_000)

  it('hands each child the charter its own row binds', async () => {
    const started: StartedPersonas = new Map()
    const ctx = await boot(started)
    const charters = new Map(loadPersonas(BUNDLED_AGENTS_ROOT).map(persona => [persona.name, persona.charter]))

    for (const name of PERSONA_NAMES) {
      await ctx.tools.execute({
        signal: SIGNAL,
        callId: CallId(`call-${name}`),
        name: subagentToolName(name),
        arguments: { description: name, prompt: 'do the step', run_in_background: false },
        agent: fakeAgent(),
      })
    }

    expect([...started.keys()]).toEqual([...PERSONA_NAMES])
    for (const name of PERSONA_NAMES) expect(started.get(name), name).toBe(charters.get(name))
  }, 30_000)
})
