// @vitest-environment jsdom
/**
 * The plugin body: which seats it fills, at which rank, and what it hands
 * back when its fiber goes down.
 *
 * The load-bearing case is the last one (risk R2): ui-tool's shipped tree,
 * this package's card in its frame, and a per-tool view registered under
 * `bash` all render together, through the live registry. Filling the frame
 * rather than shadowing the Chat Node is what makes that possible, so this
 * test is the proof that the workbench card costs no per-tool view.
 */
import type { ReactNode } from 'react'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot, SessionId, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { conversationSnapshot, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ToolCallOwnerProps, ToolTreeProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { ToolCallTree } from '@deepseek-ai/dsh-client-ui-tool/src/client/tool/ToolCallTree.tsx'
import type { ModelHintSource } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const NODE_SLOT = 'conversation.chat.node'
const VIEW_SLOT = 'tool.call.toolview'
const FRAME_SLOT = 'tool.call.frame'
const TAIL_SLOT = 'conversation.chat.turnTail'
const ACTION_SLOT = 'conversation.session.header.actions'
const SESSION = 's1' as SessionId

/**
 * A Context carrying the five services the plugin injects, with recording
 * doubles.
 * @param withModelMenu - whether ui-model-selection's service stands, which is
 * the only thing the price-hint contribution waits for.
 * @returns the context, the live registry, and the doubles' records.
 */
async function bench(withModelMenu = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const register = vi.fn()
  ctx.provide('conversationEvents', { register } as never)
  const showDetailsMode = vi.fn()
  ctx.provide('layout', { showDetailsMode } as never)
  const locate = vi.fn()
  ctx.provide('sciFiles', { locate } as never)
  const hints: ModelHintSource[] = []
  if (withModelMenu) {
    ctx.provide('modelDirectories', {
      registerHints(source: ModelHintSource) {
        hints.push(source)
        return () => { hints.splice(hints.indexOf(source), 1) }
      },
    } as never)
  }
  const slots = ctx.get('slots') as SlotRegistry
  const declare = () => slots.register({
    name: 'root',
    children: {
      [NODE_SLOT]: { kind: 'keyed', scope: 'session' },
      [TAIL_SLOT]: { kind: 'chain', scope: 'session' },
      [ACTION_SLOT]: { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  /** Install the shipped `tool-call` entry, which declares both Tool child seats. */
  const declareTool = () => slots.register({
    name: NODE_SLOT,
    key: 'tool-call',
    children: {
      [VIEW_SLOT]: { kind: 'keyed', scope: 'session' },
      [FRAME_SLOT]: { kind: 'single', scope: 'session' },
    },
  } as never, () => null)
  return { ctx, slots, declare, declareTool, register, showDetailsMode, locate, hints }
}

/** The `bash` view a shipped-shaped tool plugin registered before the sci card. */
function BashView({ block }: ToolCallOwnerProps) {
  return <em data-testid="bash-view">{'kind' in block ? 'settled bash' : 'running bash'}</em>
}

/** A settled `bash` call the shipped tree can render. */
function bashResult(): ToolResultNode {
  return {
    kind: 'tool-result', seq: 4, time: 2_000, callId: 'c1',
    call: { name: 'bash', argsRaw: '{"command":"ls"}' },
    callTime: 1_000, content: [], isError: false, callView: null, resultView: null, subCalls: [],
  }
}

/**
 * A `renderSlot` bound to the live registry: keyed seats dispatch by entry
 * key, the single frame takes its one entry, and each occupant receives the
 * framework seats the production renderer would have supplied.
 * @param slots - the live registry.
 * @param snapshot - the session snapshot the occupants read.
 * @returns the dispatching render function.
 */
function registryRenderSlot(slots: SlotRegistry, snapshot: ConversationSnapshot): ToolTreeProps['renderSlot'] {
  type SlotKey = Parameters<SlotRegistry['entries']>[0]
  return (key: SlotKey, owner: object, opts?: { entryKey?: string; fallback?: ReactNode }) => {
    const entries = slots.entries(key)
    const entry = key === FRAME_SLOT
      ? entries[0]
      : entries.find(candidate => candidate.options.key === opts?.entryKey)
    if (entry === undefined) return opts?.fallback ?? null
    // The two framework seats the production renderer supplies to a
    // session-scope occupant; everything else is the owner share verbatim.
    const seats = {
      useSession: (selector: (value: ConversationSnapshot) => unknown) => selector(snapshot),
      t: makeTranslate(zh),
    }
    const Component = entry.component as (props: object) => ReactNode
    return <Component {...owner} {...seats} />
  }
}

/** Render ui-tool's shipped tree over one settled call, through the live registry. */
function renderTree(slots: SlotRegistry) {
  const snapshot = conversationSnapshot(SESSION)
  const props = {
    renderSlot: registryRenderSlot(slots, snapshot),
    node: {
      key: 'n1', kind: 'tool-call', id: 'c1', target: 'chat', anchorSeq: 4,
      location: { kind: 'unresolved' }, visibility: 'visible', data: { root: bashResult() },
    },
    selectedCallId: undefined,
    cwd: undefined,
    openFile: vi.fn(),
    inspectCall: vi.fn(),
    openDetails: vi.fn(),
    useSession: (selector: (s: ConversationSnapshot) => unknown) => selector(snapshot),
    useHostDescription: (selector: (value: undefined) => unknown) => selector(undefined),
    t: makeTranslate(zh),
  } as unknown as ToolTreeProps
  return render(<ToolCallTree {...props} />)
}

describe('ui-sci-conversation plugin body', () => {
  it('declares the services it drives', () => {
    expect(inject).toEqual(['slots', 'locale', 'conversationEvents', 'layout', 'sciFiles'])
  })

  it('fills the Tool call frame whether ui-tool declared before or after apply, and leaves with its fiber', async () => {
    const before = await bench()
    before.declare()
    before.declareTool()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(before.slots.entries(FRAME_SLOT)).toHaveLength(1)
    await fiber.dispose()
    expect(before.slots.entries(FRAME_SLOT)).toHaveLength(0)

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries(FRAME_SLOT)).toHaveLength(0)
    after.declare()
    after.declareTool()
    await Promise.resolve()
    expect(after.slots.entries(FRAME_SLOT)).toHaveLength(1)
  })

  it('leaves the Chat Node cell alone, so ui-tool keeps owning the Tool child seats', async () => {
    const b = await bench()
    b.declare()
    b.declareTool()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // One entry only: the shipped one. Nothing shadows it, so its `children`
    // declaration — and every per-tool view registered against it — stands.
    expect(b.slots.entries(NODE_SLOT)).toHaveLength(1)
    expect(b.slots.entries(FRAME_SLOT)[0]?.options.priority).toBeUndefined()
  })

  it('registers the workbench card inside the shipped tree, without displacing a per-tool view', async () => {
    const b = await bench()
    b.declare()
    b.declareTool()
    b.slots.register({ name: VIEW_SLOT, key: 'bash' } as never, BashView)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const view = renderTree(b.slots)
    // The sci card frames the call: its head names the tool and its state.
    expect(screen.getByText('命令执行')).toBeTruthy()
    expect(screen.getByText(zh['card.done'])).toBeTruthy()
    // ...and the `bash` view registered before it still renders, inside the
    // card's own body, once the card is expanded.
    expect(screen.queryByTestId('bash-view')).toBeNull()
    screen.getByLabelText(zh['card.expand']).click()
    expect(view.container.querySelector('[data-chat-call-id="c1"]')).not.toBeNull()
  })

  it('registers the turn accumulator that closes the hand-over gap, and only that', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.register).toHaveBeenCalledTimes(1)
    expect(b.register.mock.calls[0]?.[0]).toMatchObject({ kind: 'sci-artifacts' })
  })

  it('tries the artifact chips before the shipped produced-files row', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const tail = b.slots.entries(TAIL_SLOT)
    expect(tail).toHaveLength(1)
    // A chain elects the first non-null selector in ascending priority, so a
    // rank below ui-deliverables' default 0 replaces that row instead of
    // doubling it.
    expect(tail[0]?.options.priority).toBe(-10)
    expect(tail[0]?.select).toBeTypeOf('function')
    await fiber.dispose()
    expect(b.slots.entries(TAIL_SLOT)).toHaveLength(0)
  })

  it('adds one session-header action, after the shipped ones', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const actions = b.slots.entries(ACTION_SLOT)
    expect(actions).toHaveLength(1)
    expect(actions[0]?.options.id).toBe('sci-open-artifacts')
    expect(actions[0]?.options.order).toBe(30)
    await fiber.dispose()
    expect(b.slots.entries(ACTION_SLOT)).toHaveLength(0)
  })

  it('binds the two gestures its entries inject to the services it was given', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const tailFace = (b.slots.entries(TAIL_SLOT)[0]?.inject as () => { locate: (p: string) => void })()
    tailFace.locate('/w/report.md')
    expect(b.locate).toHaveBeenCalledWith('/w/report.md')
    const actionFace = (b.slots.entries(ACTION_SLOT)[0]?.inject as () => {
      showDetailsMode: (id: string) => void
    })()
    actionFace.showDetailsMode('files')
    expect(b.showDetailsMode).toHaveBeenCalledWith('files')
  })

  it('names its own dictionary on every entry, so the cards read this package copy', async () => {
    const b = await bench()
    b.declare()
    b.declareTool()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    for (const key of [FRAME_SLOT, TAIL_SLOT, ACTION_SLOT] as const) {
      expect(b.slots.entries(key)[0]?.locale).toBe('sci-conversation')
    }
  })

  it('contributes the model menu price hints, and takes them back with its fiber', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.hints).toHaveLength(1)
    // The contributed source is the gate read, bound to this plugin's own
    // dictionary — the runtime's fallback locale here, which is English.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [{
        model: 'deepseek-v4-flash', route: 'deepseek-official',
        hitMicros: 14_000, missMicros: 440_000, outMicros: 1_320_000, ratioX1000: 1000,
      }] }),
    }) as unknown as Response))
    await expect(b.hints[0]?.()).resolves.toEqual([{
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      lines: ['List input $0.4400 / 1M · output $1.3200 / 1M · cache hit $0.0140 / 1M'],
    }])
    expect(en['model.official']).toContain('List input {input}')
    vi.unstubAllGlobals()
    await fiber.dispose()
    expect(b.hints).toHaveLength(0)
  })

  it('keeps every other contribution in a composition that has no model menu', async () => {
    const b = await bench(false)
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.hints).toHaveLength(0)
    expect(b.slots.entries(TAIL_SLOT)).toHaveLength(1)
    expect(b.slots.entries(ACTION_SLOT)).toHaveLength(1)
  })

  it('mounts its stylesheet for exactly the plugin lifetime', async () => {
    const b = await bench()
    b.declare()
    // Sibling cases in this file leave their own fibers mounted, so the
    // assertion is on this mount's delta rather than on an empty head.
    const tags = () => document.head.querySelectorAll(
      'style[data-plugin="@deepseek-ai/dsh-client-ui-sci-conversation"]')
    const before = tags().length
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(tags()).toHaveLength(before + 1)
    // The sheet's text is a build-time `?inline` import (empty under the unit
    // -test transform), so the sheet identity is what this asserts.
    expect(tags()[before]?.getAttribute('data-plugin-css'))
      .toBe('@deepseek-ai/dsh-client-ui-sci-conversation/sci-conversation.css')
    await fiber.dispose()
    expect(tags()).toHaveLength(before)
  })
})

describe('ui-sci-conversation node half', () => {
  it('is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
