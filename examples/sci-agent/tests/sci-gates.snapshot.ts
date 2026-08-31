/**
 * Assembled-composition snapshots of the five refusals the science profile
 * owes a model: the balanced tier's fan-out guard, the cluster tier's
 * declaration latch, the delivery area rule, the irreversible-action question,
 * and manifest field ownership.
 *
 * Keyless by construction. Every recorded output is produced by the harness —
 * a gate's refusal text and the events it logged — so the scenarios boot the
 * example's real `cordis.yml` through the app's own `boot()` and drive the tool
 * registry directly. No model call decides any assertion here, and none is
 * made; what a model would see is exactly the tool result each file records.
 * @module sci-gates-snapshot
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { bootExample, call, resultText, sciEvents, seed, type BootedExample } from './harness.ts'

const booted: BootedExample[] = []

afterEach(async () => {
  for (const example of booted.splice(0)) await example.dispose()
})

/** Boot one tier and register it for teardown. */
async function open(tier: 'balanced' | 'cluster' | 'auto'): Promise<BootedExample> {
  const example = await bootExample(tier)
  booted.push(example)
  return example
}

/** Record one scenario's model-visible result and the events it left behind. */
async function record(name: string, example: BootedExample, text: string): Promise<void> {
  const body = `${text}\n---\nsci events: ${JSON.stringify(sciEvents(example), undefined, 2)}\n`
  await expect(body).toMatchFileSnapshot(fileURLToPath(new URL(`./snapshots/${name}.txt`, import.meta.url)))
}

describe('sci-balanced-refuses-fanout', () => {
  it('denies a fan-out tool that reached the catalog after load', async () => {
    const example = await open('balanced')
    // The composition mounts no fan-out tool, which is what `sci-tier` verifies
    // against the catalog at load. This registers one afterwards — the exact
    // case the deny-only guard exists for, since a later `tools/pre-execute`
    // listener answering `allow` still meets it.
    example.ctx.tools.register(defineTool({
      name: 'workflow',
      description: 'a fan-out tool this tier does not compose',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: () => Promise.resolve('ran'),
    }))

    const result = await call(example, 'workflow', {})

    expect(result.isError).toBe(true)
    await record('sci-balanced-refuses-fanout', example, resultText(example, result))
  }, 60_000)
})

describe('sci-cluster-requires-plan', () => {
  it('denies the first fan-out of a session that declared no plan', async () => {
    const example = await open('cluster')

    const result = await call(example, 'workflow', { script: 'await agent("do the work")' })

    expect(result.isError).toBe(true)
    await record('sci-cluster-requires-plan', example, resultText(example, result))
  }, 60_000)
})

describe('sci-auto-requires-resolution', () => {
  it('denies the first fan-out of an auto session the model has not resolved', async () => {
    const example = await open('auto')

    const result = await call(example, 'workflow', { script: 'await agent("do the work")' })

    expect(result.isError).toBe(true)
    await record('sci-auto-requires-resolution', example, resultText(example, result))
  }, 60_000)
})

describe('sci-auto-raises-then-gates', () => {
  it('refuses a fan-out after a balanced resolution, admits the raise, then meets the latch', async () => {
    const example = await open('auto')

    await call(example, 'resolve_tier', { tier: 'balanced', reason: 'One pass covers the literature scan.' })
    const balanced = await call(example, 'workflow', { script: 'await agent("do the work")' })
    await call(example, 'resolve_tier', { tier: 'cluster', reason: 'The scan turned up six corpora that need parallel close reading.' })
    const undeclared = await call(example, 'workflow', { script: 'await agent("do the work")' })

    expect(balanced.isError).toBe(true)
    expect(undeclared.isError).toBe(true)
    await record('sci-auto-raises-then-gates', example, `${resultText(example, balanced)}\n---\n${resultText(example, undeclared)}`)
  }, 60_000)
})

describe('sci-cluster-gates-persona-delegation', () => {
  it('denies a persona delegation tool of a session that declared no plan', async () => {
    const example = await open('cluster')

    // The cluster composition mounts one `tool-subagent` per persona, so the
    // name the model calls is the persona it gets. The latch has to cover every
    // one of those names: a gate that only knew the old unbound `subagent`
    // would let six tools past it.
    const result = await call(example, 'subagent_scout', {
      description: 'Find the methods file',
      prompt: 'Locate the methods section of the entropy paper.',
    })

    expect(result.isError).toBe(true)
    expect(example.ctx.tools.schemas().map(schema => schema.name)).toContain('subagent_deliverer')
    await record('sci-cluster-gates-persona-delegation', example, resultText(example, result))
  }, 60_000)
})

describe('sci-deliver-rejects-tmp', () => {
  it('refuses a deliverable that is still in the scratch directory', async () => {
    const example = await open('balanced')
    await seed(example, 'tmp/figure.png', 'not really a png')

    const result = await call(example, 'deliver_files', {
      files: [{ path: 'tmp/figure.png', title: 'Figure 1', description: 'the effect by group' }],
    })

    expect(resultText(example, result)).toContain('tmp/figure.png')
    await record('sci-deliver-rejects-tmp', example, resultText(example, result))
  }, 60_000)
})

describe('sci-guard-asks-for-elf', () => {
  it('turns running a downloaded binary into an authorization question', async () => {
    const example = await open('balanced')
    // ELF magic plus padding: the guard identifies the candidate by its leading
    // bytes, not by its name or its mode.
    await seed(example, 'tmp/solver', new Uint8Array([0x7f, 0x45, 0x4c, 0x46, ...new Array<number>(60).fill(0)]))

    const result = await call(example, 'bash', {
      command: './tmp/solver --run',
      description: 'Run the downloaded solver',
    })

    await record('sci-guard-asks-for-elf', example, resultText(example, result))
  }, 60_000)
})

describe('sci-versions-append-only', () => {
  it('refuses a manifest edit that rewrites the platform-owned history', async () => {
    const example = await open('balanced')
    const manifest = {
      version: 1,
      title: 'Treatment effect by group',
      language: 'en',
      style: 'nature',
      entry: 'code/plot.py',
      history: [{ version: 1, at: '2026-01-01T00:00:00Z', note: 'first render' }],
      annotations: [],
    }
    await seed(example, 'sciplots/effect-by-group/effect-by-group.sciplot', `${JSON.stringify(manifest, undefined, 2)}\n`)

    const result = await call(example, 'write', {
      file_path: 'sciplots/effect-by-group/effect-by-group.sciplot',
      content: `${JSON.stringify({ ...manifest, history: [] }, undefined, 2)}\n`,
    })

    expect(result.isError).toBe(true)
    await record('sci-versions-append-only', example, resultText(example, result))
  }, 60_000)
})
