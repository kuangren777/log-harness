// Proves the metering is real, Loader-composed configurability and not a
// hand-built ctx.plugin() suite: a cordis.yml booted through the real Loader
// mounts the session store, the LLM registry, and dsh-sci-credit, and
// everything this package owns — the pre-adapter refusal, the platform fetch
// against a real HTTP gate, the minted request id, the charge, and the session
// record — appears from that composition alone, with no injected transport,
// clock, id mint, or timer.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import * as SciCredit from '@deepseek-ai/dsh-sci-credit'
import { CREDIT_EXHAUSTED_CODE } from '@deepseek-ai/dsh-sci-credit'

/** The VM bearer token the composed gate accepts. */
const VM_TOKEN = 'vm-token-for-loader-suite'

/** An adapter that reports one million uncached input tokens and stops. */
class MockAdapter extends LlmAdapter {
  /** How many times the adapter was reached. */
  calls = 0

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    yield { type: 'usage', usage: { inputTokens: 1_000_000, outputTokens: 0 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** One charge body the composed gate received. */
interface RecordedCharge {
  requestId: string
  model: string
  usdMicros: number
  priceVersion: number
}

/** A real loopback gate serving the three credit endpoints. */
interface FakeGate {
  readonly url: string
  readonly charges: RecordedCharge[]
  /** Whether the tenant reads as spent. */
  exhausted: boolean
  close: () => Promise<void>
}

/**
 * Start a loopback HTTP gate over the real credit API.
 * @returns the gate's base URL, the charges it received, and its closer.
 */
async function startGate(): Promise<FakeGate> {
  const charges: RecordedCharge[] = []
  const state = { exhausted: false }
  const server: Server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${VM_TOKEN}`) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end('{"error":"credit: 需要 VM token"}')
      return
    }
    const path = new URL(request.url ?? '/', 'http://gate').pathname
    const json = (body: unknown): void => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (path === '/gate/api/credit/pricing') {
      json({
        version: 5,
        models: [{ model: 'deepseek-v4-pro', hitMicros: 0, missMicros: 2_000_000, outMicros: 0, peakMultiplierX1000: 1000 }],
        peak: { timezone: 'UTC', weekdays: [0, 1, 2, 3, 4, 5, 6], windows: [['00:00', '24:00']], offPeakMultiplierX1000: 500 },
      })
      return
    }
    if (path === '/gate/api/credit/balance') {
      json(state.exhausted
        ? { planMicros: 0, creditMicros: 0, totalMicros: 0, exhausted: true }
        : { planMicros: 10_000_000, creditMicros: 0, totalMicros: 10_000_000, exhausted: false })
      return
    }
    if (path === '/gate/api/credit/charge') {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(chunk as Buffer))
      request.on('end', () => {
        charges.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as RecordedCharge)
        json({ duplicate: false, charged: {}, entries: [] })
      })
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{"error":"unknown credit endpoint"}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${String(port)}`,
    charges,
    get exhausted(): boolean { return state.exhausted },
    set exhausted(value: boolean) { state.exhausted = value },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined || error === null) resolve()
        else reject(error)
      })
    }),
  }
}

let root: string | undefined
let context: Context | undefined
let gate: FakeGate | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  await gate?.close()
  gate = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** The booted composition one test drives. */
interface Booted {
  readonly ctx: Context
  readonly session: Session
  readonly adapter: MockAdapter
  readonly gate: FakeGate
  readonly spoolPath: string
}

/**
 * Boot a cordis.yml carrying the given sci-credit config block.
 * @param configLines - additional indented config lines for the sci-credit entry.
 * @param vmToken - the token to declare, or `null` to omit the field entirely.
 * @returns the booted context, its session, the adapter, and the composed gate.
 */
async function boot(configLines: readonly string[] = [], vmToken: string | null = VM_TOKEN): Promise<Booted> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-credit-loader-'))
  gate = await startGate()
  const spoolPath = join(root, '.sci', 'credit-spool.jsonl')
  const configPath = join(root, 'cordis.yml')
  await (await import('node:fs/promises')).writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-sci-credit'",
    '  config:',
    `    gateUrl: ${JSON.stringify(gate.url)}`,
    ...vmToken === null ? [] : [`    vmToken: ${JSON.stringify(vmToken)}`],
    `    spoolPath: ${JSON.stringify(spoolPath)}`,
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
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-sci-credit', SciCredit],
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

  const adapter = new MockAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const session = ctx.sessions.create(SessionId('sci-credit-loader'), {})
  session.append('turn/start', { turn: 1 })
  return { ctx, session, adapter, gate, spoolPath }
}

/** Run one model call through the composed waterfall. */
async function run(booted: Booted): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of booted.ctx.llm.stream({
    provider: 'mock', model: 'deepseek-v4-pro', messages: [], sessionId: booted.session.id,
  })) chunks.push(chunk)
  return chunks
}

/** The charge records one session's log holds. */
function charged(session: Session): SessionEvent<'sci/credit-charged'>[] {
  return session.events.filter((event): event is SessionEvent<'sci/credit-charged'> => event.type === 'sci/credit-charged')
}

/**
 * Wait until a predicate holds, polling the event loop.
 * @param predicate - the condition to wait for.
 * @param label - what is being waited for, used in the timeout failure.
 */
async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${label}`)
}

describe('sci-credit real Loader composition through cordis.yml', () => {
  it('charges a real gate over the platform transport and records it on the session', async () => {
    const booted = await boot(['    pricing: gate'])
    // The composed card lands asynchronously; the built-in table would price
    // the same call at 1.32 rather than 2.00 per 1M uncached input tokens.
    await until(() => booted.gate.charges.length === 0, 'the boot rate-card fetch')

    const chunks = await run(booted)
    await until(() => booted.gate.charges.length === 1, 'the charge to reach the gate')
    await until(() => charged(booted.session).length === 1, 'the charge record')

    expect(booted.adapter.calls).toBe(1)
    expect(chunks.map(chunk => chunk.type)).toEqual(['usage', 'finish'])
    const charge = booted.gate.charges[0]
    // The composed card declares every hour of every day peak, so the price is
    // the full 2.00 per 1M uncached input tokens whenever this suite runs.
    expect(charge).toMatchObject({ model: 'deepseek-v4-pro', priceVersion: 5, usdMicros: 2_000_000 })
    // The minted id is a real UUID and the record names the same one.
    expect(charge?.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(charged(booted.session)[0]?.data).toMatchObject({
      requestId: charge?.requestId,
      usdMicros: 2_000_000,
      peak: true,
      spooled: false,
    })
  }, 30_000)

  it('refuses the call before the adapter when the composed gate reports the tenant spent', async () => {
    const booted = await boot()
    booted.gate.exhausted = true

    const chunks = await run(booted)

    expect(booted.adapter.calls).toBe(0)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ reason: { kind: 'error', failure: { code: CREDIT_EXHAUSTED_CODE } } })
  }, 30_000)

  it('prices from the built-in official card when the configuration declares no gate fetch', async () => {
    const booted = await boot([
      '    pricing:',
      "      - model: 'deepseek-v4-pro'",
      '        hitMicros: 0',
      '        missMicros: 3000000',
      '        outMicros: 0',
    ])

    await run(booted)
    await until(() => booted.gate.charges.length === 1, 'the charge to reach the gate')
    await until(() => charged(booted.session).length === 1, 'the charge record')

    // A configured card carries the built-in peak schedule, so what the price
    // is depends on when this suite runs; the record states which side it was.
    const peak = charged(booted.session)[0]?.data.peak
    expect(booted.gate.charges[0]).toMatchObject({
      usdMicros: peak === true ? 3_000_000 : 1_500_000,
      priceVersion: 0,
    })
  }, 30_000)

  it.each([
    { label: 'the VM token is omitted', configLines: [], vmToken: null, failure: /vmToken/ },
    { label: 'the VM token is blank', configLines: [], vmToken: '   ', failure: /must be a non-empty gate VM token/ },
    { label: 'an inline rate card prices nothing', configLines: ['    pricing: []'], vmToken: VM_TOKEN, failure: /must list at least one model/ },
  ])('fails loading when $label', async ({ configLines, vmToken, failure }) => {
    await expect(boot(configLines, vmToken)).rejects.toThrow(failure)
  }, 30_000)
})
