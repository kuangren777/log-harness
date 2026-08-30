// @vitest-environment jsdom
/**
 * The plugin body: the two seats it fills, the mount of the `sci.agents`
 * Remote namespace it owns, the adaptation between that namespace and the
 * plain vocabulary the view consumes, the route from a log row back into the
 * research flow, and the proof that both registrations and the namespace all
 * leave with the plugin fiber.
 */
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import agentsRemote from '@deepseek-ai/dsh-sci-agents/remote'
import * as AgentsInvariant from '../src/invariant.ts'
import { apply as nodeApply } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { AgentsRailItem, type AgentsRailItemProps } from '../src/client/RailItem.tsx'
import type { SciAgentsInjected } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { CALLS, CATALOG, RESEARCHER, ROSTER } from './records.client.ts'

// The shipped Chinese copy is what this suite asserts, so it states the
// browser locale the service reads at startup.
usePinnedBrowserLanguages('zh-CN')

const VIEW = 'view'
const RAIL = 'rail.item'

/** Cordis service key the mounted namespace registers itself under. */
const NAMESPACE = 'remote.sci.agents'

/** One patch the configuration cases write. */
const PATCH = { enabled: false } as const

afterEach(cleanup)

/** Bench inputs each case varies. */
interface BenchOptions {
  /** Whether the mount installs its namespace service; false leaves it absent. */
  mounts?: boolean
  /** Hold the mount open until `release()`, to observe the pre-mount window. */
  defer?: boolean
}

/** A Context carrying the five services the plugin injects, all faked. */
async function bench(options: BenchOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const showView = vi.fn()
  ctx.provide('layout', { showView })

  const agents = {
    roster: vi.fn(async () => ({ ok: true as const, value: { agents: ROSTER } })),
    configure: vi.fn(async () => ({ ok: true as const, value: { agent: RESEARCHER } })),
    calls: vi.fn(async () => ({ ok: true as const, value: { calls: CALLS } })),
    models: vi.fn(async () => ({ ok: true as const, value: { providers: CATALOG } })),
  }
  // The Remote service double: `$mount` records the contribution and installs
  // the namespace service exactly as the real mount does, so this suite
  // exercises the service key the plugin reads rather than a stub property.
  const mounted: unknown[] = []
  const unmount = vi.fn(async () => { disposeNamespace?.() })
  let disposeNamespace: (() => void) | undefined
  let releaseMount: (() => void) | undefined
  const mount = vi.fn(async (contribution: unknown) => {
    mounted.push(contribution)
    if (options.defer === true) await new Promise<void>((resolve) => { releaseMount = resolve })
    if (options.mounts !== false) disposeNamespace = ctx.provide(NAMESPACE, agents)
    return unmount
  })
  ctx.provide('remote', { $mount: mount })

  const open = vi.fn()
  ctx.provide('sessions', { open })

  const slots = ctx.get('slots') as SlotRegistry
  // The two declarations this package registers into, as ui-layout and the
  // sci shell contribute them.
  const declare = () => slots.register({
    name: 'root',
    children: {
      [VIEW]: { kind: 'keyed', scope: 'root' },
      [RAIL]: { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  return {
    ctx, slots, declare, showView, agents, open,
    mount, mounted, unmount, release: () => { releaseMount?.() },
  }
}

/** Install the plugin over a bench and hand back both plus the injected face. */
async function installed(options: BenchOptions = {}) {
  const b = await bench(options)
  b.declare()
  await b.ctx.plugin({ inject: [...inject], apply }).await()
  return { ...b, face: faceOf(b.slots) }
}

/** The injected face of the installed view entry. */
function faceOf(slots: SlotRegistry): SciAgentsInjected {
  const entry = slots.entries(VIEW)[0]
  return (entry?.inject as unknown as () => SciAgentsInjected)()
}

/** One host failure envelope under the code a case is about. */
function refusal(code: string) {
  return { ok: false, error: { code, message: 'refused' } } as never
}

describe('ui-sci-agents plugin body', () => {
  it('declares the services it drives, and not the one it provides', () => {
    expect(inject).toEqual(['slots', 'locale', 'layout', 'remote', 'sessions'])
    // Injecting the namespace this plugin mounts would be a boot deadlock:
    // the fiber would wait forever for its own apply.
    expect(inject).not.toContain(NAMESPACE)
  })

  it('mounts the host contribution before anything it registers can render', async () => {
    const b = await bench({ defer: true })
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await Promise.resolve()

    // The generated contribution itself, not a hand-written descriptor.
    expect(b.mounted).toEqual([agentsRemote])
    // Nothing is seated while the mount is still out: the view cannot render
    // against a namespace that does not exist yet.
    expect(b.slots.entries(VIEW)).toHaveLength(0)

    b.release()
    await fiber.await()
    expect(b.slots.entries(VIEW)).toHaveLength(1)
    expect(b.ctx.get(NAMESPACE)).toBe(b.agents)
  })

  it('unmounts the namespace with the plugin fiber', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.ctx.get(NAMESPACE)).toBe(b.agents)

    await fiber.dispose()
    expect(b.unmount).toHaveBeenCalledTimes(1)
    expect(b.ctx.get(NAMESPACE)).toBeUndefined()
  })

  it('installs the view and the rail button, and folds both up', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(b.slots.entries(VIEW as never).map(entry => entry.options.key)).toEqual(['agents'])
    expect(b.slots.entries(RAIL as never).map(entry => [entry.options.id, entry.options.order]))
      .toEqual([['agents', 35]])
    // The view carries the shared store: the page and the persona survive a
    // trip through the research flow.
    expect(b.slots.entries(VIEW as never)[0]?.store).toBeDefined()

    await fiber.dispose()
    for (const key of [VIEW, RAIL]) {
      expect(b.slots.entries(key as never)).toHaveLength(0)
    }
  })

  it('installs whether the seats are declared before or after apply', async () => {
    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries(VIEW as never)).toHaveLength(0)

    after.declare()
    await Promise.resolve()
    expect(after.slots.entries(VIEW as never)).toHaveLength(1)
    expect(after.slots.entries(RAIL as never)).toHaveLength(1)
  })

  it('labels the rail button from its own dictionary', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const locale = b.ctx.get('locale') as LocaleRuntime
    expect(locale.bind('sci-agents' as never)('rail.agents' as never)).toBe('智能体')
  })
})

describe('the injected face over the sci.agents namespace', () => {
  it('unwraps the roster, the log, and the catalog into plain records', async () => {
    const b = await installed()

    await expect(b.face.roster()).resolves.toEqual({ ok: true, agents: ROSTER })
    await expect(b.face.calls('researcher')).resolves.toEqual({ ok: true, calls: CALLS })
    await expect(b.face.models()).resolves.toEqual(CATALOG)
    expect(b.agents.calls).toHaveBeenCalledWith({ persona: 'researcher' })
  })

  it('writes one patch under its persona id and answers with the host s agent', async () => {
    const b = await installed()

    await expect(b.face.configure('researcher', PATCH)).resolves.toEqual({ ok: true, agent: RESEARCHER })
    // The stable persona id, never the display name: the name is the one
    // field a host-side persona edit can move.
    expect(b.agents.configure).toHaveBeenCalledWith({ persona: 'researcher', patch: PATCH })
  })

  it('turns a host failure into its code, never a throw', async () => {
    const b = await installed()
    b.agents.roster.mockResolvedValueOnce(refusal('AUDIT_UNAVAILABLE'))
    await expect(b.face.roster()).resolves.toEqual({ ok: false, code: 'AUDIT_UNAVAILABLE' })

    b.agents.configure.mockResolvedValueOnce(refusal('SETTINGS_WRITE_DENIED'))
    await expect(b.face.configure('researcher', PATCH)).resolves
      .toEqual({ ok: false, code: 'SETTINGS_WRITE_DENIED' })

    b.agents.calls.mockResolvedValueOnce(refusal('AUDIT_UNAVAILABLE'))
    await expect(b.face.calls('researcher')).resolves.toEqual({ ok: false, code: 'AUDIT_UNAVAILABLE' })

    // An unreadable catalog is an empty one: the configuration page then
    // states that the agent follows the session model, which is true.
    b.agents.models.mockResolvedValueOnce(refusal('MODEL_CATALOG_UNAVAILABLE'))
    await expect(b.face.models()).resolves.toEqual([])
  })

  it('folds a rejected call into the same stated vocabulary', async () => {
    const b = await installed()
    b.agents.roster.mockRejectedValueOnce(new Error('socket closed'))
    await expect(b.face.roster()).resolves.toEqual({ ok: false, code: 'AGENTS_REMOTE_FAILED' })

    // A write that never reached an answer must say the save failed rather
    // than let an unhandled rejection escape the switch's click chain.
    b.agents.configure.mockRejectedValueOnce(new Error('socket closed'))
    await expect(b.face.configure('researcher', PATCH)).resolves
      .toEqual({ ok: false, code: 'AGENTS_REMOTE_FAILED' })

    b.agents.calls.mockRejectedValueOnce(new Error('socket closed'))
    await expect(b.face.calls('researcher')).resolves.toEqual({ ok: false, code: 'AGENTS_REMOTE_FAILED' })

    b.agents.models.mockRejectedValueOnce(new Error('socket closed'))
    await expect(b.face.models()).resolves.toEqual([])
  })

  it('reports an absent namespace as data, never as a rejected promise', async () => {
    const b = await installed({ mounts: false })
    expect(b.ctx.get(NAMESPACE)).toBeUndefined()

    await expect(b.face.roster()).resolves.toEqual({ ok: false, code: 'AGENTS_REMOTE_UNAVAILABLE' })
    await expect(b.face.configure('researcher', PATCH)).resolves
      .toEqual({ ok: false, code: 'AGENTS_REMOTE_UNAVAILABLE' })
    await expect(b.face.calls('researcher')).resolves.toEqual({ ok: false, code: 'AGENTS_REMOTE_UNAVAILABLE' })
    await expect(b.face.models()).resolves.toEqual([])

    expect(b.agents.roster).not.toHaveBeenCalled()
    expect(b.agents.configure).not.toHaveBeenCalled()
    expect(b.agents.calls).not.toHaveBeenCalled()
    expect(b.agents.models).not.toHaveBeenCalled()
  })
})

describe('the route from a log row back into the research flow', () => {
  it('opens the delegating session and shows the conversation view', async () => {
    const b = await installed()
    b.face.openSession('session-42')

    // The audit record carries the session id as plain wire text, and the
    // runtime's branded handle is that same string.
    expect(b.open).toHaveBeenCalledWith('session-42')
    expect(b.showView).toHaveBeenCalledWith('conversation')
  })
})

describe('AgentsRailItem', () => {
  /** The button's props over one view id. */
  function itemProps(view: string, showView = vi.fn()) {
    return {
      props: { view, showView, t: makeTranslate(zh) } as unknown as AgentsRailItemProps,
      showView,
    }
  }

  it('is pressed exactly while the frame shows the agent view', () => {
    const view = render(<AgentsRailItem {...itemProps('agents').props} />)
    expect(screen.getByRole('button', { name: '智能体' }).getAttribute('aria-pressed')).toBe('true')
    view.unmount()

    render(<AgentsRailItem {...itemProps('conversation').props} />)
    expect(screen.getByRole('button', { name: '智能体' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('routes the frame to the agent view', () => {
    const b = itemProps('conversation')
    render(<AgentsRailItem {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: '智能体' }))
    expect(b.showView).toHaveBeenCalledWith('agents')
  })
})

describe('package companions', () => {
  it('reserves package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(AgentsInvariant).await()).resolves.toBeDefined()
  })

  it('keeps the node half as an inert Loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
