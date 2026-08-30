// @vitest-environment jsdom
/**
 * The plugin body: the four seats it fills, the adaptation between the
 * `sci.citations` Remote namespace and the plain vocabulary the view
 * consumes, the re-read that follows every write, and the proof that all four
 * registrations leave with the plugin fiber.
 */
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import citationsRemote from '@deepseek-ai/dsh-sci-citations/remote'
import * as CitationsInvariant from '../src/invariant.ts'
import { apply as nodeApply } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { CitationsRailItem, type CitationsRailItemProps } from '../src/client/RailItem.tsx'
import type { SciCitationsInjected } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { poolOf, PROJECT, PROJECTS } from './citations.client.ts'

// The shipped Chinese copy is what this suite asserts, so it states the
// browser locale the service reads at startup.
usePinnedBrowserLanguages('zh-CN')

const VIEW = 'view'
const RAIL = 'rail.item'
const TOOLVIEW = 'tool.call.toolview'

/** Cordis service key the mounted namespace registers itself under. */
const NAMESPACE = 'remote.sci.citations'

/** The pool the fake host answers every read with. */
const POOL = poolOf()

afterEach(cleanup)

/** Bench inputs each case varies. */
interface BenchOptions {
  /** Whether the mount installs its namespace service; false leaves it absent. */
  mounts?: boolean
  /** Hold the mount open until `release()`, to observe the pre-mount window. */
  defer?: boolean
}

/** A Context carrying the three services the plugin injects, all faked. */
async function bench(options: BenchOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))

  const written = { ok: true as const, value: { written: true } }
  const citations = {
    projects: vi.fn(async () => ({ ok: true as const, value: { projects: PROJECTS } })),
    pool: vi.fn(async () => ({ ok: true as const, value: POOL })),
    upsertGroup: vi.fn(async () => written),
    removeGroup: vi.fn(async () => written),
    move: vi.fn(async () => written),
    removeCitation: vi.fn(async () => written),
    rescan: vi.fn(async () => written),
    exportBibtex: vi.fn(async () => ({ ok: true as const, value: { bibtex: '@article{zhao2024,}' } })),
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
    if (options.mounts !== false) disposeNamespace = ctx.provide(NAMESPACE, citations)
    return unmount
  })
  ctx.provide('remote', { $mount: mount })

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
  return { ctx, slots, declare, citations, mount, mounted, unmount, release: () => { releaseMount?.() } }
}

/** Install the plugin over a bench and hand back both plus the injected face. */
async function installed(options: BenchOptions = {}) {
  const b = await bench(options)
  b.declare()
  await b.ctx.plugin({ inject: [...inject], apply }).await()
  const entry = b.slots.entries(VIEW)[0]
  return { ...b, face: (entry?.inject as unknown as () => SciCitationsInjected)() }
}

describe('ui-sci-citations plugin body', () => {
  it('declares the services it drives, and not the one it provides', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote'])
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
    expect(b.mounted).toEqual([citationsRemote])
    expect(b.slots.entries(VIEW as never)).toHaveLength(0)

    b.release()
    await fiber.await()
    expect(b.slots.entries(VIEW as never)).toHaveLength(1)
    expect(b.ctx.get(NAMESPACE)).toBe(b.citations)
  })

  it('unmounts the namespace with the plugin fiber', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.ctx.get(NAMESPACE)).toBe(b.citations)

    await fiber.dispose()
    expect(b.unmount).toHaveBeenCalledTimes(1)
    expect(b.ctx.get(NAMESPACE)).toBeUndefined()
  })

  it('installs the view, the rail button, and both tool rows, and folds them all up', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(b.slots.entries(VIEW as never).map(entry => entry.options.key)).toEqual(['citations'])
    expect(b.slots.entries(RAIL as never).map(entry => [entry.options.id, entry.options.order]))
      .toEqual([['citations', 30]])
    expect(b.slots.entries(TOOLVIEW as never).map(entry => entry.options.key))
      .toEqual(['citations_list', 'citations_add'])
    expect(b.slots.entries(VIEW as never)[0]?.store).toBeDefined()

    await fiber.dispose()
    for (const key of [VIEW, RAIL, TOOLVIEW]) {
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
    expect(after.slots.entries(TOOLVIEW as never)).toHaveLength(2)
  })

  it('labels the rail button from its own dictionary', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const locale = b.ctx.get('locale') as LocaleRuntime
    expect(locale.bind('sci-citations' as never)('rail.citations' as never)).toBe('引用池')
  })
})

describe('the injected face over the sci.citations namespace', () => {
  it('unwraps the project list and the pool into plain records', async () => {
    const b = await installed()
    await expect(b.face.projects()).resolves.toEqual(PROJECTS)
    await expect(b.face.pool(PROJECT)).resolves.toEqual({ ok: true, pool: POOL })
    expect(b.citations.pool).toHaveBeenCalledWith({ project: PROJECT })
  })

  it('turns a host failure into its code, never a throw', async () => {
    const b = await installed()
    b.citations.pool.mockResolvedValueOnce(
      { ok: false, error: { code: 'CITATIONS_NO_SUCH_PROJECT', message: 'no such project' } } as never,
    )
    await expect(b.face.pool(PROJECT)).resolves.toEqual({ ok: false, code: 'CITATIONS_NO_SUCH_PROJECT' })

    b.citations.projects.mockResolvedValueOnce(
      { ok: false, error: { code: 'CITATIONS_ROOT_UNREADABLE', message: 'no root' } } as never,
    )
    await expect(b.face.projects()).resolves.toEqual([])
  })

  it('folds a rejected call into the same stated vocabulary', async () => {
    const b = await installed()
    b.citations.pool.mockRejectedValueOnce(new Error('socket closed'))
    await expect(b.face.pool(PROJECT)).resolves.toEqual({ ok: false, code: 'CITATIONS_REMOTE_FAILED' })

    b.citations.projects.mockRejectedValueOnce(new Error('socket closed'))
    await expect(b.face.projects()).resolves.toEqual([])

    b.citations.move.mockRejectedValueOnce(new Error('socket closed'))
    await expect(b.face.move(PROJECT, 'zhao2024', 'defect')).resolves
      .toEqual({ ok: false, code: 'CITATIONS_REMOTE_FAILED' })

    b.citations.exportBibtex.mockRejectedValueOnce(new Error('socket closed'))
    await expect(b.face.exportBibtex(PROJECT)).resolves
      .toEqual({ ok: false, code: 'CITATIONS_REMOTE_FAILED' })
  })

  it('reports an absent namespace as data, never as a rejected promise', async () => {
    const b = await installed({ mounts: false })
    expect(b.ctx.get(NAMESPACE)).toBeUndefined()

    await expect(b.face.projects()).resolves.toEqual([])
    for (const outcome of [
      await b.face.pool(PROJECT),
      await b.face.createGroup(PROJECT, '器件验证'),
      await b.face.removeGroup(PROJECT, 'halogen'),
      await b.face.move(PROJECT, 'zhao2024', 'defect'),
      await b.face.remove(PROJECT, 'zhao2024'),
      await b.face.rescan(PROJECT),
      await b.face.exportBibtex(PROJECT),
    ]) {
      expect(outcome).toEqual({ ok: false, code: 'CITATIONS_REMOTE_UNAVAILABLE' })
    }
    expect(b.citations.pool).not.toHaveBeenCalled()
  })

  it('spends each write on the endpoint the spec names, then re-reads the pool', async () => {
    const b = await installed()
    const writes: [Promise<unknown>, ReturnType<typeof vi.fn>, unknown][] = [
      [b.face.createGroup(PROJECT, '器件验证'), b.citations.upsertGroup, { project: PROJECT, label: '器件验证' }],
      [b.face.removeGroup(PROJECT, 'halogen'), b.citations.removeGroup, { project: PROJECT, key: 'halogen' }],
      [b.face.move(PROJECT, 'zhao2024', 'defect'), b.citations.move,
        { project: PROJECT, citekey: 'zhao2024', group: 'defect' }],
      [b.face.remove(PROJECT, 'zhao2024'), b.citations.removeCitation, { project: PROJECT, citekey: 'zhao2024' }],
      [b.face.rescan(PROJECT), b.citations.rescan, { project: PROJECT }],
    ]
    for (const [pending, endpoint, request] of writes) {
      await expect(pending).resolves.toEqual({ ok: true, pool: POOL })
      expect(endpoint).toHaveBeenCalledWith(request)
    }
    // One re-read per write: the view's numbers come from a `pool` answer, so
    // a write's own return value is never drawn.
    expect(b.citations.pool).toHaveBeenCalledTimes(writes.length)
  })

  it('reports a refused write as its code, and does not re-read behind it', async () => {
    const b = await installed()
    b.citations.removeCitation.mockResolvedValueOnce(
      { ok: false, error: { code: 'CITATIONS_NO_SUCH_CITEKEY', message: 'unknown citekey' } } as never,
    )
    await expect(b.face.remove(PROJECT, 'nope')).resolves
      .toEqual({ ok: false, code: 'CITATIONS_NO_SUCH_CITEKEY' })
    expect(b.citations.pool).not.toHaveBeenCalled()
  })

  it('renders BibTeX for the whole project or for one group', async () => {
    const b = await installed()
    await expect(b.face.exportBibtex(PROJECT)).resolves.toEqual({ ok: true, bibtex: '@article{zhao2024,}' })
    expect(b.citations.exportBibtex).toHaveBeenCalledWith({ project: PROJECT, group: undefined })

    await b.face.exportBibtex(PROJECT, 'halogen')
    expect(b.citations.exportBibtex).toHaveBeenLastCalledWith({ project: PROJECT, group: 'halogen' })

    b.citations.exportBibtex.mockResolvedValueOnce(
      { ok: false, error: { code: 'CITATIONS_EMPTY_EXPORT', message: 'nothing to export' } } as never,
    )
    await expect(b.face.exportBibtex(PROJECT)).resolves
      .toEqual({ ok: false, code: 'CITATIONS_EMPTY_EXPORT' })
  })
})

describe('CitationsRailItem', () => {
  /** The button's props over one view id. */
  function itemProps(view: string, showView = vi.fn()) {
    return {
      props: { view, showView, t: makeTranslate(zh) } as unknown as CitationsRailItemProps,
      showView,
    }
  }

  it('is pressed exactly while the frame shows the citation pool', () => {
    const view = render(<CitationsRailItem {...itemProps('citations').props} />)
    expect(screen.getByRole('button', { name: '引用池' }).getAttribute('aria-pressed')).toBe('true')
    view.unmount()

    render(<CitationsRailItem {...itemProps('conversation').props} />)
    expect(screen.getByRole('button', { name: '引用池' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('routes the frame to the citation pool', () => {
    const b = itemProps('conversation')
    render(<CitationsRailItem {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: '引用池' }))
    expect(b.showView).toHaveBeenCalledWith('citations')
  })
})

describe('package companions', () => {
  it('reserves package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(CitationsInvariant).await()).resolves.toBeDefined()
  })

  it('keeps the node half as an inert Loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
