// Proves the plan layer is real, Loader-composed configurability and not a
// hand-built ctx.plugin() suite: a cordis.yml booted through the real Loader
// mounts the tool registry and dsh-sci-plan, and the durable output this
// package owns — the `declare_research_plan` tool and the required-on-read
// `sci/plan-declared` event the fan-out gate spends — appears from that
// composition alone. `maxAgents` is read from the same file, and a value the
// schema refuses fails the load rather than the first declaration.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CallId } from '@deepseek-ai/dsh-llm'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as SciPlan from '@deepseek-ai/dsh-sci-plan'
import { PLAN_TOOL } from '@deepseek-ai/dsh-sci-plan'
import type { SciPlanDeclaredData } from '@deepseek-ai/dsh-sci-plan'
import { ARCHIVED_INSTALL, ARCHIVED_SURVEY } from './archived-calls.ts'

const SIGNAL = new AbortController().signal

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot a cordis.yml carrying the given sci-plan config block, with one agent to call the tool. */
async function boot(configLines: readonly string[] = []): Promise<{ ctx: Context; agent: Agent }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-plan-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-sci-plan'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-sci-plan', SciPlan],
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

  const session = ctx.sessions.create()
  const scope = ctx.plugin(() => {})
  const agent: Agent = {
    id: session.header.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    followup: () => {},
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel: () => {},
    runMaintenance: task => task(SIGNAL),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return { ctx, agent }
}

/** Declare one plan through the composed registry. */
function declare(ctx: Context, agent: Agent, args: unknown): Promise<{ isError: boolean; content: { type: string; text?: string }[] }> {
  return ctx.tools.execute({
    signal: SIGNAL,
    callId: CallId('declare'),
    name: PLAN_TOOL,
    arguments: args,
    agent,
  })
}

/** Every plan declaration in the agent's log. */
function declarations(agent: Agent): SessionEvent[] {
  return agent.session.events.filter(event => event.type === 'sci/plan-declared')
}

describe('sci-plan real Loader composition through cordis.yml', () => {
  it('mounts the tool and records the declaration as a required-on-read event', async () => {
    const booted = await boot()

    const result = await declare(booted.ctx, booted.agent, ARCHIVED_SURVEY)

    expect(result.isError).toBe(false)
    const [event] = declarations(booted.agent)
    expect(event?.ignorable).toBeUndefined()
    const declared = event?.data as SciPlanDeclaredData
    expect(declared.agents.map(entry => entry.icon)).toEqual(['web', 'search', 'security'])
    expect(declared.edges).toEqual([])
    expect(typeof declared.planId).toBe('string')
  }, 30_000)

  it('admits sixteen agents by default, which is wider than any observed fan-out', async () => {
    const booted = await boot()

    const result = await declare(booted.ctx, booted.agent, {
      agents: Array.from({ length: 16 }, (_unused, index) => ({
        id: `a${index}`, name: `card ${index}`, icon: 'security', task: `do ${index}`,
      })),
    })

    expect(result.isError).toBe(false)
    expect(declarations(booted.agent)).toHaveLength(1)
  }, 30_000)

  it('narrows the plan width from the configuration file', async () => {
    const booted = await boot(['    maxAgents: 1'])

    const refused = await declare(booted.ctx, booted.agent, ARCHIVED_INSTALL)
    const accepted = await declare(booted.ctx, booted.agent, { agents: [ARCHIVED_SURVEY.agents[2]] })

    expect(refused.isError).toBe(true)
    expect(refused.content.map(block => block.text).join('')).toContain('this deployment admits at most 1')
    expect(accepted.isError).toBe(false)
    expect(declarations(booted.agent)).toHaveLength(1)
  }, 30_000)

  it.each([
    { label: 'the agent cap admits no plan at all', configLines: ['    maxAgents: 0'] },
    { label: 'the agent cap is fractional', configLines: ['    maxAgents: 1.5'] },
  ])('fails loading when $label', async ({ configLines }) => {
    await expect(boot(configLines)).rejects.toThrow(/maxAgents/)
  }, 30_000)
})
