// The tool's model-facing text is its contract with the model, so the result
// rendering is pinned verbatim: what reached the user, and — the change from
// the studied platform's opaque failure — which file did not and why.
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  DELIVER_TOOL,
  DeliveryId,
  applyDeliverTool,
  describeDeliverTool,
  formatDeliveryResult,
  formatSize,
  parseDeliveryRequest,
} from '@deepseek-ai/dsh-sci-deliver'
import type { DeliveryOutcome, Recorder } from '@deepseek-ai/dsh-sci-deliver'
import { PROJECT, WORKSPACE } from './harness.ts'

describe('formatSize', () => {
  it.each([
    { bytes: 0, text: '0 B' },
    { bytes: 1023, text: '1023 B' },
    { bytes: 1024, text: '1 KB' },
    { bytes: 12_288, text: '12 KB' },
    { bytes: 2_306_867, text: '2.2 MB' },
  ])('renders $bytes as $text', ({ bytes, text }) => {
    expect(formatSize(bytes)).toBe(text)
  })
})

describe('formatDeliveryResult', () => {
  it('lists what reached the user', () => {
    expect(formatDeliveryResult({
      delivered: [
        { deliveryId: 'd1', path: `${WORKSPACE}/report.md`, title: 'Report', kind: 'file', size: 12_288, sha256: 'a' },
        { deliveryId: 'd2', path: `${WORKSPACE}/fig1.png`, title: 'Figure 1', kind: 'file', size: 348_160, sha256: 'b' },
      ],
      rejected: [],
    })).toBe('delivered 2 files: report.md (12 KB), fig1.png (340 KB)')
  })

  it('names every refused file with its reason', () => {
    expect(formatDeliveryResult({
      delivered: [{ deliveryId: 'd1', path: `${WORKSPACE}/a.md`, title: 'A', kind: 'file', size: 5, sha256: 'a' }],
      rejected: [{ path: `${PROJECT}/tmp/b.pdf`, reason: 'outside the delivery area' }],
    }).split('\n')).toEqual([
      'delivered 1 file: a.md (5 B)',
      `rejected ${PROJECT}/tmp/b.pdf: outside the delivery area`,
    ])
  })

  it('renders a call in which nothing reached the user', () => {
    expect(formatDeliveryResult({
      delivered: [],
      rejected: [{ path: 'tmp/a.pdf', reason: 'outside the delivery area' }],
    })).toBe('rejected tmp/a.pdf: outside the delivery area')
  })
})

describe('parseDeliveryRequest', () => {
  it('trims the text fields and drops an empty description', () => {
    expect(parseDeliveryRequest({ path: ' a.md ', title: ' A ', description: '   ' }))
      .toEqual({ path: 'a.md', title: 'A' })
  })

  it('keeps a description that says something', () => {
    expect(parseDeliveryRequest({ path: 'a.md', title: 'A', description: ' the findings ' }))
      .toEqual({ path: 'a.md', title: 'A', description: 'the findings' })
  })

  it.each([
    { label: 'a blank path', file: { path: '   ', title: 'A' }, failure: '`path` must be a non-empty string' },
    { label: 'a blank title', file: { path: 'a.md', title: ' ' }, failure: '`title` must be a non-empty string' },
  ])('refuses $label', ({ file, failure }) => {
    expect(() => parseDeliveryRequest(file)).toThrow(failure)
  })
})

describe('describeDeliverTool', () => {
  it('names the configured delivery directory, which is what the model must get right', () => {
    expect(describeDeliverTool('deliverables')).toContain('deliverables/ directory')
    expect(describeDeliverTool('deliverables')).toContain('copied into deliverables/')
  })
})

/** A tool registry with one agent, plus the delivery callback the tool was given. */
async function harness(deliver: Recorder): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  applyDeliverTool(ctx, deliver, 'workspace')
  const scope = ctx.plugin(() => {})
  const id = SessionId('sci-deliver-tool')
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
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return { ctx, agent }
}

/** Run one `deliver_files` call through the real registry. */
function call(ctx: Context, agent: Agent, files: unknown): Promise<{ isError: boolean; content: { type: string; text?: string }[] }> {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('deliver'),
    name: DELIVER_TOOL,
    arguments: { files },
    agent,
  })
}

/** Join the text blocks of one tool result. */
function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/** A recorder that accepts everything, numbering its deliveries. */
function accepting(): Recorder {
  let issued = 0
  return (_session, request) => {
    issued++
    return Promise.resolve<DeliveryOutcome>({
      ok: true,
      record: {
        deliveryId: DeliveryId(`d${issued}`),
        path: `${WORKSPACE}/${request.path}`,
        title: request.title,
        kind: 'file',
        size: 5120,
        sha256: 'f'.repeat(64),
      },
    })
  }
}

describe('deliver_files through the tool registry', () => {
  it('delivers every accepted file and reports the cards', async () => {
    const { ctx, agent } = await harness(accepting())

    const result = await call(ctx, agent, [
      { path: 'report.md', title: 'Report' },
      { path: 'fig1.png', title: 'Figure 1', description: 'effect by group' },
    ])

    expect(result.isError).toBe(false)
    expect(text(result)).toBe('delivered 2 files: report.md (5 KB), fig1.png (5 KB)')
    await ctx.fiber.dispose()
  })

  it('names a refused path and its remedy without failing the call (06-T3)', async () => {
    const reason = `${PROJECT}/tmp/a.pdf is outside the delivery area; only workspace/ and a bundle's own `
      + '.paper / .sciplot manifest can be delivered — copy it into workspace/ under a descriptive name '
      + 'and deliver the copy'
    const { ctx, agent } = await harness(() => Promise.resolve<DeliveryOutcome>({ ok: false, reason }))

    const result = await call(ctx, agent, [{ path: `${PROJECT}/tmp/a.pdf`, title: 'Draft' }])

    expect(result.isError).toBe(false)
    expect(text(result)).toMatchInlineSnapshot(
      '"rejected /home/user/sci/projects/p1/tmp/a.pdf: /home/user/sci/projects/p1/tmp/a.pdf is outside the delivery area; only workspace/ and a bundle\'s own .paper / .sciplot manifest can be delivered — copy it into workspace/ under a descriptive name and deliver the copy"',
    )
    await ctx.fiber.dispose()
  })

  it('rejects a call that delivers nothing', async () => {
    const deliver = vi.fn<Recorder>()
    const { ctx, agent } = await harness(deliver)

    const result = await call(ctx, agent, [])

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('at least one file')
    expect(deliver).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('rejects a caller with no session to log the delivery on', async () => {
    const { ctx } = await harness(accepting())

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('deliver-no-agent'),
      name: DELIVER_TOOL,
      arguments: { files: [{ path: 'report.md', title: 'Report' }] },
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires an owning agent session')
    await ctx.fiber.dispose()
  })

  it('rejects a blank title before any delivery is attempted', async () => {
    const deliver = vi.fn<Recorder>()
    const { ctx, agent } = await harness(deliver)

    const result = await call(ctx, agent, [{ path: 'report.md', title: '  ' }])

    expect(result.isError).toBe(true)
    expect(deliver).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('presents the pending call with every file it touches', async () => {
    const { ctx } = await harness(accepting())
    const definition = ctx.tools.schemas().find(schema => schema.name === DELIVER_TOOL)
    expect(definition?.description).toContain('workspace/ directory')

    const view = ctx.tools.get(DELIVER_TOOL)?.presentCall?.({ files: [{ path: 'report.md', title: 'Report' }] })

    expect(view).toEqual({
      card: 'generic',
      title: 'Deliver 1 file',
      locations: [{ path: 'report.md' }],
    })
    await ctx.fiber.dispose()
  })

  it('unregisters the tool when its fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const scope = ctx.plugin({
      inject: ['tools'],
      apply: (child: Context) => { applyDeliverTool(child, accepting(), 'workspace') },
    })
    await scope

    expect(ctx.tools.get(DELIVER_TOOL)).toBeDefined()
    await scope.dispose()
    expect(ctx.tools.get(DELIVER_TOOL)).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
