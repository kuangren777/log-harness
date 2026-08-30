// @vitest-environment jsdom
/**
 * The plugin body: the three seats it fills, the adaptation between the
 * `sci.literature` Remote namespace and the plain vocabulary the view
 * consumes, the deep-dive route into the research flow, and the proof that
 * all three registrations leave with the plugin fiber.
 */
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import literatureRemote from '@deepseek-ai/dsh-sci-literature/remote'
import * as SearchInvariant from '../src/invariant.ts'
import { apply as nodeApply } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { SearchRailItem, type SearchRailItemProps } from '../src/client/RailItem.tsx'
import type { RecentQuery, SciSearchInjected } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { FULL, resultOf } from './records.client.ts'

// The shipped Chinese copy is what this suite asserts, so it states the
// browser locale the service reads at startup.
usePinnedBrowserLanguages('zh-CN')

const VIEW = 'view'
const RAIL = 'rail.item'
const TOOLVIEW = 'tool.call.toolview'
const ACTIONS = 'search.result.actions'

/** Cordis service key the mounted namespace registers itself under. */
const NAMESPACE = 'remote.sci.literature'

/** The history the fake host answers with. */
const RECENT: readonly RecentQuery[] = [{ id: 'h1', query: 'zT', at: 7, hits: 3 }]

afterEach(cleanup)

/** One workspace row as the workspaces list carries it. */
interface FakeWorkspace { workspaceId: string; sessionIds: readonly string[] }

/** Bench inputs each deep-dive case varies. */
interface BenchOptions {
  /** Whether the mount installs its namespace service; false leaves it absent. */
  mounts?: boolean
  /** Hold the mount open until `release()`, to observe the pre-mount window. */
  defer?: boolean
  current?: string
  workspaces?: readonly FakeWorkspace[]
  recentWorkspaceId?: string
  connect?: (id: string) => Promise<string>
  scoped?: boolean
}

/** A Context carrying the eight services the plugin injects, all faked. */
async function bench(options: BenchOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const showView = vi.fn()
  ctx.provide('layout', { showView })

  const literature = {
    search: vi.fn(async () => ({ ok: true as const, value: resultOf([FULL]) })),
    recent: vi.fn(async () => ({ ok: true as const, value: { entries: RECENT } })),
    forget: vi.fn(async () => ({ ok: true as const, value: { ok: true as const } })),
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
    if (options.mounts !== false) disposeNamespace = ctx.provide(NAMESPACE, literature)
    return unmount
  })
  ctx.provide('remote', { $mount: mount })

  const open = vi.fn()
  const scope = { tag: 'session-scope' }
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ current: options.current }) },
    scope: vi.fn(() => (options.scoped === false ? undefined : scope)),
    open,
  })
  const connectWorkspace = vi.fn(options.connect ?? (async (id: string) => `session-of-${id}`))
  ctx.provide('workspaces', {
    list: {
      getSnapshot: () => ({
        items: options.workspaces ?? [],
        recentWorkspaceId: options.recentWorkspaceId,
      }),
    },
    connectWorkspace,
  })
  const setDraft = vi.fn()
  const inputFor = vi.fn(() => ({ setDraft }))
  ctx.provide('conversation', { input: { for: inputFor } })

  const slots = ctx.get('slots') as SlotRegistry
  // The three declarations this package registers into, as ui-layout, the sci
  // shell, and ui-tool contribute them.
  const declare = () => slots.register({
    name: 'root',
    children: {
      [VIEW]: { kind: 'keyed', scope: 'root' },
      [RAIL]: { kind: 'list', scope: 'root' },
      [TOOLVIEW]: { kind: 'keyed', scope: 'session' },
    },
  } as never, () => null)
  return {
    ctx, slots, declare, showView, literature, open, setDraft, inputFor, connectWorkspace, scope,
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
function faceOf(slots: SlotRegistry): SciSearchInjected {
  const entry = slots.entries(VIEW)[0]
  return (entry?.inject as unknown as () => SciSearchInjected)()
}

describe('ui-sci-search plugin body', () => {
  it('declares the services it drives, and not the one it provides', () => {
    expect(inject).toEqual(['slots', 'locale', 'layout', 'remote', 'sessions', 'workspaces', 'conversation'])
    // Injecting the namespace this plugin mounts is the boot deadlock the
    // mount fixes: the fiber would wait forever for its own apply.
    expect(inject).not.toContain(NAMESPACE)
  })

  it('mounts the host contribution before anything it registers can render', async () => {
    const b = await bench({ defer: true })
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await Promise.resolve()

    // The generated contribution itself, not a hand-written descriptor.
    expect(b.mounted).toEqual([literatureRemote])
    // Nothing is seated while the mount is still out: the view cannot render
    // against a namespace that does not exist yet.
    expect(b.slots.entries(VIEW)).toHaveLength(0)

    b.release()
    await fiber.await()
    expect(b.slots.entries(VIEW)).toHaveLength(1)
    expect(b.ctx.get(NAMESPACE)).toBe(b.literature)
  })

  it('unmounts the namespace with the plugin fiber', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.ctx.get(NAMESPACE)).toBe(b.literature)

    await fiber.dispose()
    expect(b.unmount).toHaveBeenCalledTimes(1)
    expect(b.ctx.get(NAMESPACE)).toBeUndefined()
  })

  it('installs the view, the rail button, and the tool row, and folds all three up', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(b.slots.entries(VIEW as never).map(entry => entry.options.key)).toEqual(['search'])
    expect(b.slots.entries(RAIL as never).map(entry => [entry.options.id, entry.options.order]))
      .toEqual([['search', 40]])
    expect(b.slots.entries(TOOLVIEW as never).map(entry => entry.options.key)).toEqual(['literature_search'])
    expect(b.slots.entries(VIEW as never)[0]?.store).toBeDefined()

    await fiber.dispose()
    for (const key of [VIEW, RAIL, TOOLVIEW]) {
      expect(b.slots.entries(key as never)).toHaveLength(0)
    }
  })

  it('declares the per-record action strip, and collapses it with the view', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(b.slots.entries(VIEW as never)[0]?.children).toEqual({
      [ACTIONS]: { kind: 'list', scope: 'root' },
    })
    expect(b.slots.spec(ACTIONS as never)).toEqual({ kind: 'list', scope: 'root' })

    // Declaring is claiming: the seat exists exactly as long as the view that
    // draws it, so composing this package out takes the strip with it.
    await fiber.dispose()
    expect(b.slots.spec(ACTIONS as never)).toBeUndefined()
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
    expect(locale.bind('sci-search' as never)('rail.search' as never)).toBe('检索')
  })
})

describe('the injected face over the sci.literature namespace', () => {
  it('unwraps a successful search into plain records', async () => {
    const b = await installed()
    await expect(b.face.search({ query: 'zT' })).resolves.toEqual({ ok: true, result: resultOf([FULL]) })
    expect(b.literature.search).toHaveBeenCalledWith({ query: 'zT' })
  })

  it('turns a host failure into its code, never a throw', async () => {
    const b = await installed()
    b.literature.search.mockResolvedValueOnce(
      { ok: false, error: { code: 'LITERATURE_ALL_SOURCES_FAILED', message: 'all four failed' } } as never,
    )
    await expect(b.face.search({ query: 'zT' })).resolves
      .toEqual({ ok: false, code: 'LITERATURE_ALL_SOURCES_FAILED' })
  })

  it('reads the history, and reports an unreadable one as an empty strip', async () => {
    const b = await installed()
    await expect(b.face.recent()).resolves.toEqual(RECENT)

    b.literature.recent.mockResolvedValueOnce(
      { ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: 'no domain' } } as never,
    )
    await expect(b.face.recent()).resolves.toEqual([])
  })

  it('forgets one row by id and answers with the history that remains', async () => {
    const b = await installed()
    b.literature.recent.mockResolvedValueOnce({ ok: true, value: { entries: [] } } as never)
    await expect(b.face.forget('h1')).resolves.toEqual([])
    expect(b.literature.forget).toHaveBeenCalledWith({ id: 'h1' })
  })

  it('folds a rejected call into the same stated vocabulary', async () => {
    const b = await installed()
    b.literature.search.mockRejectedValueOnce(new Error('socket closed'))
    await expect(b.face.search({ query: 'zT' })).resolves
      .toEqual({ ok: false, code: 'LITERATURE_REMOTE_FAILED' })

    // A rejected history read would otherwise surface as an unhandled
    // rejection inside the view's click chain and freeze the strip.
    b.literature.recent.mockRejectedValueOnce(new Error('socket closed'))
    await expect(b.face.recent()).resolves.toEqual([])

    // A rejected forget still re-reads: the host's next answer is the
    // authority on what the strip shows.
    b.literature.forget.mockRejectedValueOnce(new Error('socket closed'))
    await expect(b.face.forget('h1')).resolves.toEqual(RECENT)
  })

  it('reports an absent namespace as data, never as a rejected promise', async () => {
    const b = await installed({ mounts: false })
    expect(b.ctx.get(NAMESPACE)).toBeUndefined()

    await expect(b.face.search({ query: 'zT' })).resolves
      .toEqual({ ok: false, code: 'LITERATURE_REMOTE_UNAVAILABLE' })
    await expect(b.face.recent()).resolves.toEqual([])
    await expect(b.face.forget('h1')).resolves.toEqual([])
    expect(b.literature.search).not.toHaveBeenCalled()
    expect(b.literature.forget).not.toHaveBeenCalled()
  })

  it('answers an unreadable post-forget history as an empty strip', async () => {
    const b = await installed()
    b.literature.recent.mockResolvedValueOnce(
      { ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: 'no domain' } } as never,
    )
    await expect(b.face.forget('h1')).resolves.toEqual([])
  })
})

describe('the deep-dive route into the research flow', () => {
  it('connects the current session s workspace, prefills it, and switches views', async () => {
    const b = await installed({
      current: 's1',
      workspaces: [{ workspaceId: 'w1', sessionIds: ['s1'] }],
      recentWorkspaceId: 'w9',
    })
    b.face.deepDive('请用 literature_search 检索「zT」')

    await vi.waitFor(() => { expect(b.showView).toHaveBeenCalledWith('conversation') })
    expect(b.connectWorkspace).toHaveBeenCalledWith('w1')
    expect(b.inputFor).toHaveBeenCalledWith(b.scope)
    expect(b.setDraft).toHaveBeenCalledWith('请用 literature_search 检索「zT」')
    expect(b.open).toHaveBeenCalledWith('session-of-w1')
  })

  it('falls back to the most recent workspace when no session is current', async () => {
    const b = await installed({ recentWorkspaceId: 'w9' })
    b.face.deepDive('prompt')

    await vi.waitFor(() => { expect(b.open).toHaveBeenCalledWith('session-of-w9') })
    expect(b.connectWorkspace).toHaveBeenCalledWith('w9')
  })

  it('uses the current session as it is when there is no workspace at all', async () => {
    const b = await installed({ current: 's1', scoped: false })
    b.face.deepDive('prompt')

    await vi.waitFor(() => { expect(b.open).toHaveBeenCalledWith('s1') })
    expect(b.connectWorkspace).not.toHaveBeenCalled()
    // An unscoped session takes the view switch without the prefill rather
    // than losing both.
    expect(b.setDraft).not.toHaveBeenCalled()
    expect(b.showView).toHaveBeenCalledWith('conversation')
  })

  it('still switches views when there is nowhere to put the prompt', async () => {
    const b = await installed()
    b.face.deepDive('prompt')

    await vi.waitFor(() => { expect(b.showView).toHaveBeenCalledWith('conversation') })
    expect(b.open).not.toHaveBeenCalled()
  })

  it('reports a failed connect and leaves the user in the research flow', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const b = await installed({
      recentWorkspaceId: 'w9',
      connect: async () => { throw new Error('host refused') },
    })
    b.face.deepDive('prompt')

    await vi.waitFor(() => { expect(b.showView).toHaveBeenCalledWith('conversation') })
    expect(warn.mock.calls[0]?.[0]).toBe('literature deep dive failed:')
    expect(b.open).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('SearchRailItem', () => {
  /** The button's props over one view id. */
  function itemProps(view: string, showView = vi.fn()) {
    return {
      props: { view, showView, t: makeTranslate(zh) } as unknown as SearchRailItemProps,
      showView,
    }
  }

  it('is pressed exactly while the frame shows the search view', () => {
    const view = render(<SearchRailItem {...itemProps('search').props} />)
    expect(screen.getByRole('button', { name: '检索' }).getAttribute('aria-pressed')).toBe('true')
    view.unmount()

    render(<SearchRailItem {...itemProps('conversation').props} />)
    expect(screen.getByRole('button', { name: '检索' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('routes the frame to the search view', () => {
    const b = itemProps('conversation')
    render(<SearchRailItem {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: '检索' }))
    expect(b.showView).toHaveBeenCalledWith('search')
  })
})

describe('package companions', () => {
  it('reserves package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(SearchInvariant).await()).resolves.toBeDefined()
  })

  it('keeps the node half as an inert Loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
