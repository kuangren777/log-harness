/**
 * The two domains a running agent can reach without a request: the tools it
 * may call and the model route it may send to. Both are decided from the
 * account that owns the agent's session, so every case here drives the real
 * events the loop emits rather than calling the resolver directly.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import AgentRegistry, { agentEvents, Inbox, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { GroupId, UserId } from '@deepseek-ai/dsh-auth'
import type { AuthService, PermissionRule, Principal } from '@deepseek-ai/dsh-auth'
import { installAgentEnforcement, ModelRouteForbidden } from '../src/enforcement.ts'

const OWNER = UserId('owner-1')

const member: Principal = {
  kind: 'user', userId: OWNER, email: 'owner@example.test', groups: [GroupId('g-1')], admin: false,
}

/** An auth double serving only the reads the enforcement makes. */
function authDouble(options: { owner?: UserId; principal?: Principal; rules?: PermissionRule[] }): AuthService {
  return {
    ownerOfSession: () => Promise.resolve(options.owner),
    principalOf: () => Promise.resolve(options.principal),
    rulesFor: () => Promise.resolve(options.rules ?? []),
  } as unknown as AuthService
}

/** A tool whose execution answers with its own name, so a refusal is visible. */
function tool(name: string) {
  return defineContentToolFixture({
    name,
    description: name,
    parameters: {},
    execute: () => Promise.resolve([{ type: 'text' as const, text: `ran:${name}` }]),
  })
}

/**
 * Mount the tool runtime, register two global tools, and publish one agent
 * whose `ctx` is a real scope — the pair `tools.restrict` needs.
 */
async function harness(auth: AuthService | undefined): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  ctx.tools.register(tool('read'))
  ctx.tools.register(tool('bash'))
  if (auth !== undefined) ctx.provide('auth', auth)

  const id = SessionId('governed-session')
  const session = Session.create(id, [], { version: 0, id, createdAt: 0, cwd: '/workspace' })
  const agent = {
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() {},
    runMaintenance: (task: (signal: AbortSignal) => unknown) => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  } as unknown as Agent
  await ctx.plugin((inner: Context) => {
    ;(agent as { ctx: Context }).ctx = createScope(inner, agent).ctx
  })
  if (auth !== undefined) installAgentEnforcement(ctx)
  return { ctx, agent }
}

/** Drive the awaited barrier the loop runs before every step. */
async function preStep(ctx: Context, agent: Agent): Promise<PreStepDecision> {
  return await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
}

/** Drive the request waterfall with the route the step resolved to. */
function requestConfig(ctx: Context, agent: Agent, provider: string, model: string): Promise<LlmCallConfig> {
  return agentEvents(ctx, agent).waterfall(
    'agent/request',
    { turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ provider, model } as LlmCallConfig),
  )
}

const denyBash: PermissionRule[] = [
  { domain: 'tool', pattern: 'read', effect: 'allow' },
  { domain: 'model', pattern: 'open/*', effect: 'allow' },
]

describe('tools per group', () => {
  it('removes a refused tool from the prompt and from execution', async () => {
    const { ctx, agent } = await harness(authDouble({ owner: OWNER, principal: member, rules: denyBash }))

    await preStep(ctx, agent)

    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toEqual(['read'])
    const refused = await ctx.tools.execute({
      signal: new AbortController().signal, callId: 'c1' as never, name: 'bash', arguments: {}, agent,
    })
    expect(refused.isError).toBe(true)
    const admitted = await ctx.tools.execute({
      signal: new AbortController().signal, callId: 'c2' as never, name: 'read', arguments: {}, agent,
    })
    expect(admitted.isError).toBe(false)
    // Another agent is untouched: the restriction is this agent's alone.
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual(['read', 'bash'])
  })

  it('installs the restriction from the session-start emit, before any step runs', async () => {
    const { ctx, agent } = await harness(authDouble({ owner: OWNER, principal: member, rules: denyBash }))

    agentEvents(ctx, agent).emit('agent/session-start', { source: 'startup' })
    // The emit is not awaited by the loop; the resolution it starts is what
    // the barrier below joins, so one resolution serves both.
    await preStep(ctx, agent)

    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toEqual(['read'])
  })

  it('registers no restriction at all when every tool is permitted', async () => {
    const { ctx, agent } = await harness(authDouble({
      owner: OWNER,
      principal: member,
      rules: [{ domain: 'tool', pattern: '*', effect: 'allow' }],
    }))

    await preStep(ctx, agent)

    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toEqual(['read', 'bash'])
  })

  it('leaves an unowned session unrestricted', async () => {
    const { ctx, agent } = await harness(authDouble({ rules: denyBash }))

    await preStep(ctx, agent)

    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toEqual(['read', 'bash'])
  })

  it('takes every tool away from an owner the provider can no longer resolve', async () => {
    const { ctx, agent } = await harness(authDouble({ owner: OWNER, rules: denyBash }))

    await preStep(ctx, agent)

    expect(ctx.tools.schemas(agent)).toEqual([])
  })

  it('reports a failed resolution to the blocked step, not as an unhandled rejection', async () => {
    const failing = {
      ownerOfSession: () => Promise.reject(new Error('auth database is unreachable')),
    } as unknown as AuthService
    const { ctx, agent } = await harness(failing)

    // The emit swallows it — nothing is waiting on that call — and the awaited
    // barrier surfaces the same failure to the turn that is blocked on it.
    agentEvents(ctx, agent).emit('agent/session-start', { source: 'startup' })
    await expect(preStep(ctx, agent)).rejects.toThrow('auth database is unreachable')
  })

  it('restricts nothing when the deployment mounts no tool runtime', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    ctx.provide('auth', authDouble({ owner: OWNER, principal: member, rules: denyBash }))
    const id = SessionId('toolless-session')
    const session = Session.create(id, [], { version: 0, id, createdAt: 0, cwd: '/workspace' })
    const agent = { id, session, ctx } as unknown as Agent
    installAgentEnforcement(ctx)

    await expect(preStep(ctx, agent)).resolves.toMatchObject({ kind: 'enter' })
  })
})

describe('models per group', () => {
  it('refuses a disallowed route at the request the selection routes', async () => {
    const { ctx, agent } = await harness(authDouble({ owner: OWNER, principal: member, rules: denyBash }))

    await expect(requestConfig(ctx, agent, 'closed', 'closed-model'))
      .rejects.toThrow(new ModelRouteForbidden('closed/closed-model'))
    await expect(requestConfig(ctx, agent, 'open', 'open-model'))
      .resolves.toMatchObject({ provider: 'open', model: 'open-model' })
  })

  it('refuses a route a later listener switched to, not the one the machine proposed', async () => {
    const { ctx, agent } = await harness(authDouble({ owner: OWNER, principal: member, rules: denyBash }))
    // Registered after the gate, so it runs inside it: the gate sees the
    // config this listener returns, which is the one the adapter would get.
    agent.ctx.on('agent/request', async (_payload, next): Promise<LlmCallConfig> => ({
      ...await next(), provider: 'closed', model: 'closed-model',
    }))

    await expect(requestConfig(ctx, agent, 'open', 'open-model'))
      .rejects.toThrow(new ModelRouteForbidden('closed/closed-model'))
  })

  it('names the refused route and nothing else', () => {
    const error = new ModelRouteForbidden('closed/closed-model')
    expect(error.name).toBe('ModelRouteForbidden')
    expect(error.route).toBe('closed/closed-model')
    expect(error.message).toBe('model "closed/closed-model" is not available for this account')
  })

  it('admits every route for an owner whose groups carry no model rule', async () => {
    const { ctx, agent } = await harness(authDouble({ owner: OWNER, principal: member, rules: [] }))

    await expect(requestConfig(ctx, agent, 'closed', 'closed-model'))
      .resolves.toMatchObject({ provider: 'closed' })
  })
})
