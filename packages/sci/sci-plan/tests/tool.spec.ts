// `declare_research_plan` is the whole model-facing surface of this package, so
// its schema, its refusals, and the text one accepted plan reads back are pinned
// here through the real tool registry. The event it appends is the authorization
// `sci-tier`'s G1 gate spends, which is why its payload and its required-on-read
// envelope are asserted next to the call that writes them.
import { describe, expect, expectTypeOf, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { Branded } from '@deepseek-ai/dsh-brand'
import {
  ICON_PERSONA,
  PLAN_ICONS,
  PLAN_TOOL,
  SciPlanId,
  applyPlanTool,
  describePlanTool,
  formatPlanRefusal,
  randomPlanId,
} from '@deepseek-ai/dsh-sci-plan'
import type { PlanInput, SciPlanDeclaredData } from '@deepseek-ai/dsh-sci-plan'
import { ARCHIVED_SURVEY, AUDITED_INSTALL } from './archived-calls.ts'

const SIGNAL = new AbortController().signal

/** One tool result as the registry returns it. */
interface ToolResult {
  readonly isError: boolean
  readonly content: { type: string; text?: string }[]
}

/** A tool registry with `declare_research_plan` mounted and one agent to call it. */
async function harness(maxAgents = 16): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  applyPlanTool(ctx, maxAgents)
  const scope = ctx.plugin(() => {})
  const id = SessionId('sci-plan-tool')
  const session = Session.create(id)
  const agent: Agent = {
    id,
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

/** Run one `declare_research_plan` call through the real registry. */
function call(ctx: Context, agent: Agent | undefined, args: unknown): Promise<ToolResult> {
  return ctx.tools.execute({
    signal: SIGNAL,
    callId: CallId('declare'),
    name: PLAN_TOOL,
    arguments: args,
    ...agent === undefined ? {} : { agent },
  })
}

/** Join the text blocks of one tool result. */
function text(result: ToolResult): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/** Every plan declaration in the agent's log. */
function declarations(agent: Agent): SessionEvent[] {
  return agent.session.events.filter(event => event.type === 'sci/plan-declared')
}

/** One well-formed declared agent — an adversary, so the composition rule holds by default and a case only states what it is testing. */
function agent(id: string, overrides: Partial<PlanInput['agents'][number]> = {}): PlanInput['agents'][number] {
  return { id, name: `card ${id}`, icon: 'security', task: `do ${id}`, ...overrides }
}

describe('describePlanTool', () => {
  it('states the obligation the fan-out gate enforces, so it is not learned from a denied call', () => {
    expect(describePlanTool()).toContain('One declaration authorizes one fan-out')
  })

  it('names the persona each icon selects', () => {
    for (const icon of PLAN_ICONS) expect(describePlanTool()).toContain(`${icon} runs as ${ICON_PERSONA[icon]}`)
  })
})

describe('formatPlanRefusal', () => {
  it('counts one problem in the singular', () => {
    expect(formatPlanRefusal(['agents is empty; a plan must declare at least one agent'])).toBe([
      'declare_research_plan declared nothing: the plan has 1 problem.',
      '- agents is empty; a plan must declare at least one agent',
    ].join('\n'))
  })

  it('lists several problems under a plural count', () => {
    expect(formatPlanRefusal(['first', 'second'])).toBe([
      'declare_research_plan declared nothing: the plan has 2 problems.',
      '- first',
      '- second',
    ].join('\n'))
  })
})

describe('plan identity', () => {
  it('brands an existing opaque string without changing it', () => {
    expect(SciPlanId('abc')).toBe('abc')
  })

  it('mints a distinct identity per declaration', () => {
    expect(randomPlanId()).not.toBe(randomPlanId())
  })

  it('types the event payload as the branded id, not a bare string', () => {
    expectTypeOf<SessionEventMap['sci/plan-declared']>().toEqualTypeOf<SciPlanDeclaredData>()
    expectTypeOf<SessionEventMap['sci/plan-declared']['planId']>().toEqualTypeOf<Branded<'SciPlanId'>>()
    expectTypeOf<string>().not.toEqualTypeOf<SessionEventMap['sci/plan-declared']['planId']>()
  })
})

describe('declare_research_plan registration', () => {
  it('publishes the archived schema: four required agent fields, the five icons, optional edges', async () => {
    const { ctx } = await harness()

    const schema = ctx.tools.schemas().find(entry => entry.name === PLAN_TOOL)

    expect(schema?.parameters).toMatchObject({
      type: 'object',
      required: ['agents'],
      properties: {
        agents: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'name', 'icon', 'task'],
            properties: { icon: { enum: [...PLAN_ICONS] } },
          },
        },
        edges: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
      },
    })
    await ctx.fiber.dispose()
  })

  it.each([
    { label: 'a plan of one agent', count: 1, title: 'Declare a research plan of 1 agent' },
    { label: 'a plan of several agents', count: 3, title: 'Declare a research plan of 3 agents' },
  ])('presents $label as a generic card', async ({ count, title }) => {
    const { ctx } = await harness()

    expect(ctx.tools.get(PLAN_TOOL)?.presentCall?.({
      agents: Array.from({ length: count }, (_unused, index) => agent(`a${index}`)),
    })).toEqual({ card: 'generic', title })
    await ctx.fiber.dispose()
  })
})

describe('declare_research_plan accepted calls', () => {
  it('renders the accepted plan in run order with the persona each icon selects', async () => {
    const { ctx, agent: caller } = await harness()

    const result = await call(ctx, caller, AUDITED_INSTALL)

    expect(result.isError).toBe(false)
    expect(text(result)).toMatchInlineSnapshot(`
      "research plan declared: 3 agents, 2 dependencies.
      1. installer — 连接器安装 [code, runs as writer]: 在项目临时目录执行预检、获取并启动已获授权的客户端。
      2. verifier — 安装结果验证 [check, runs as deliverer]: 核对安装命令退出状态及项目内留下的可见安装记录。
      3. auditor — 安装结果证伪 [security, runs as adversary]: 重跑安装命令并核对进程与文件痕迹，报出与安装报告不符之处。
      dependencies:
        installer → verifier, auditor"
    `)
    await ctx.fiber.dispose()
  })

  it('renders an edge-free plan without a dependency section', async () => {
    const { ctx, agent: caller } = await harness()

    const result = await call(ctx, caller, ARCHIVED_SURVEY)

    expect(text(result)).toMatchInlineSnapshot(`
      "research plan declared: 3 agents, no dependencies.
      1. repo-inspector — 仓库说明核查 [web, runs as researcher]: 核查 GitHub 仓库的安装方式、依赖和使用说明。
      2. environment-checker — 本机环境检查 [search, runs as scout]: 检查当前项目与可用工具，判断该连接器应安装到哪里。
      3. safety-reviewer — 安装风险复核 [security, runs as adversary]: 审阅安装脚本与权限影响，识别需要避免的风险。"
    `)
    await ctx.fiber.dispose()
  })

  it('appends one required-on-read event carrying the plan id, the agents, and the edges', async () => {
    const { ctx, agent: caller } = await harness()

    await call(ctx, caller, AUDITED_INSTALL)

    const [event] = declarations(caller)
    expect(event?.ignorable).toBeUndefined()
    const declared = event?.data as SciPlanDeclaredData
    expect(Object.keys(declared).sort()).toEqual(['agents', 'edges', 'planId'])
    expect(declared.planId).toMatch(/^[0-9a-f-]{36}$/)
    expect(declared.agents).toEqual(AUDITED_INSTALL.agents)
    expect(declared.edges).toEqual([['installer', 'verifier'], ['installer', 'auditor']])
    await ctx.fiber.dispose()
  })

  it('logs the declaration order, while the result reads back the run order', async () => {
    const { ctx, agent: caller } = await harness()

    const result = await call(ctx, caller, { agents: [agent('verifier'), agent('installer')], edges: [['installer', 'verifier']] })

    const declared = declarations(caller)[0]?.data as SciPlanDeclaredData
    expect(declared.agents.map(entry => entry.id)).toEqual(['verifier', 'installer'])
    expect(text(result)).toContain('1. installer')
    expect(text(result)).toContain('2. verifier')
    await ctx.fiber.dispose()
  })

  it('gives each declaration its own id, because the gate consumes one id per fan-out', async () => {
    const { ctx, agent: caller } = await harness()

    await call(ctx, caller, ARCHIVED_SURVEY)
    await call(ctx, caller, AUDITED_INSTALL)

    const ids = declarations(caller).map(event => (event.data as SciPlanDeclaredData).planId)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    await ctx.fiber.dispose()
  })
})

describe('declare_research_plan refusals', () => {
  it('refuses a caller with no session to record the authorization on', async () => {
    const { ctx } = await harness()

    const result = await call(ctx, undefined, ARCHIVED_SURVEY)

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires an owning agent session')
    await ctx.fiber.dispose()
  })

  it('refuses a plan wider than the deployment admits, and logs nothing', async () => {
    const { ctx, agent: caller } = await harness(2)

    const result = await call(ctx, caller, { agents: [agent('a'), agent('b'), agent('c')] })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('agents declares 3 agents; this deployment admits at most 2')
    expect(declarations(caller)).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('admits a plan exactly at the cap', async () => {
    const { ctx, agent: caller } = await harness(2)

    const result = await call(ctx, caller, { agents: [agent('a'), agent('b')] })

    expect(result.isError).toBe(false)
    expect(declarations(caller)).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it.each([
    { label: 'a repeated id', args: { agents: [agent('scan'), agent('scan')] }, reason: 'repeats the id already declared at agents[0]' },
    { label: 'a dangling edge', args: { agents: [agent('a')], edges: [['a', 'ghost']] }, reason: 'ends at "ghost", which no agent declares' },
    { label: 'a cycle', args: { agents: [agent('a'), agent('b')], edges: [['a', 'b'], ['b', 'a']] }, reason: 'form a dependency cycle' },
  ])('refuses $label and declares nothing', async ({ args, reason }) => {
    const { ctx, agent: caller } = await harness()

    const result = await call(ctx, caller, args)

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('declared nothing')
    expect(text(result)).toContain(reason)
    expect(declarations(caller)).toHaveLength(0)
    await ctx.fiber.dispose()
  })
})
