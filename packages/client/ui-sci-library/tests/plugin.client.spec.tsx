// @vitest-environment jsdom
/**
 * The plugin body: the five seats it fills, the adaptation between the
 * `sci.library` Remote namespace plus the two `/library-api` routes and the
 * plain vocabulary the components consume, the one-time id seed behind the
 * 「加入知识库」 action, and the proof that every registration leaves with the
 * plugin fiber.
 */
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import libraryRemote from '@deepseek-ai/dsh-sci-library/remote'
import * as LibraryInvariant from '../src/invariant.ts'
import { apply as nodeApply } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import type { SciLibraryAddInjected, SciLibraryInjected } from '../src/client/contract.ts'
import { BARE, FULL, pageOf } from './entries.client.ts'

// The shipped Chinese copy is what this suite asserts, so it states the
// browser locale the service reads at startup.
usePinnedBrowserLanguages('zh-CN')

const VIEW = 'view'
const RAIL = 'rail.item'
const TOOLVIEW = 'tool.call.toolview'
const ACTIONS = 'search.result.actions'

/** Cordis service key the mounted namespace registers itself under. */
const NAMESPACE = 'remote.sci.library'

afterEach(() => { vi.unstubAllGlobals() })

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

  const library = {
    list: vi.fn(async () => ({ ok: true as const, value: pageOf([FULL, BARE]) })),
    get: vi.fn(async () => ({ ok: true as const, value: { entry: FULL } })),
    add: vi.fn(async () => ({ ok: true as const, value: { entry: FULL, created: true } })),
    update: vi.fn(async () => ({ ok: true as const, value: { entry: FULL } })),
    remove: vi.fn(async () => ({ ok: true as const, value: { removed: true, filesCleared: 2 } })),
    related: vi.fn(async () => ({ ok: true as const, value: { entries: [BARE] } })),
    fetchPdf: vi.fn(async () => ({ ok: true as const, value: { entry: FULL } })),
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
    if (options.mounts !== false) disposeNamespace = ctx.provide(NAMESPACE, library)
    return unmount
  })
  ctx.provide('remote', { $mount: mount })

  const slots = ctx.get('slots') as SlotRegistry
  // The four declarations this package registers into, as ui-layout, the sci
  // shell, ui-tool, and ②'s view entry contribute them.
  const declare = () => slots.register({
    name: 'root',
    children: {
      [VIEW]: { kind: 'keyed', scope: 'root' },
      [RAIL]: { kind: 'list', scope: 'root' },
      [TOOLVIEW]: { kind: 'keyed', scope: 'session' },
      [ACTIONS]: { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  return { ctx, slots, declare, library, mount, mounted, unmount, release: () => { releaseMount?.() } }
}

/** Install the plugin over a bench and hand back both plus both injected faces. */
async function installed(options: BenchOptions = {}) {
  const b = await bench(options)
  b.declare()
  await b.ctx.plugin({ inject: [...inject], apply }).await()
  const view = (b.slots.entries(VIEW)[0]?.inject as unknown as () => SciLibraryInjected)()
  const setStored = vi.fn()
  const actionFace = (): SciLibraryAddInjected =>
    (b.slots.entries(ACTIONS)[0]?.inject as unknown as (
      actions: { setStored: (ids: readonly string[]) => void },
    ) => SciLibraryAddInjected)({ setStored })
  return { ...b, view, actionFace, setStored }
}

describe('ui-sci-library plugin body', () => {
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
    expect(b.mounted).toEqual([libraryRemote])
    // Nothing is seated while the mount is still out: the view cannot render
    // against a namespace that does not exist yet.
    expect(b.slots.entries(VIEW)).toHaveLength(0)

    b.release()
    await fiber.await()
    expect(b.slots.entries(VIEW)).toHaveLength(1)
    expect(b.ctx.get(NAMESPACE)).toBe(b.library)
  })

  it('unmounts the namespace with the plugin fiber', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.ctx.get(NAMESPACE)).toBe(b.library)

    await fiber.dispose()
    expect(b.unmount).toHaveBeenCalledTimes(1)
    expect(b.ctx.get(NAMESPACE)).toBeUndefined()
  })

  it('installs the view, the button, both tool rows, and the card action, and folds all five up', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(b.slots.entries(VIEW as never).map(entry => entry.options.key)).toEqual(['library'])
    expect(b.slots.entries(RAIL as never).map(entry => [entry.options.id, entry.options.order]))
      .toEqual([['library', 20]])
    expect(b.slots.entries(TOOLVIEW as never).map(entry => entry.options.key))
      .toEqual(['library_search', 'library_add'])
    expect(b.slots.entries(ACTIONS as never).map(entry => entry.options.id)).toEqual(['library-add'])
    // The view and the card action share one store handle: which ids the
    // library holds is a fact both surfaces have to agree on.
    expect(b.slots.entries(VIEW as never)[0]?.store)
      .toBe(b.slots.entries(ACTIONS as never)[0]?.store)

    await fiber.dispose()
    for (const key of [VIEW, RAIL, TOOLVIEW, ACTIONS]) {
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
    expect(after.slots.entries(ACTIONS as never)).toHaveLength(1)
  })

  it('labels the rail button from its own dictionary', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const locale = b.ctx.get('locale') as LocaleRuntime
    expect(locale.bind('sci-library' as never)('rail.library' as never)).toBe('知识库')
  })
})

describe('the injected view face over the sci.library namespace', () => {
  it('unwraps a successful list into the page', async () => {
    const b = await installed()
    await expect(b.view.list({ query: 'zT' })).resolves.toEqual({ ok: true, value: pageOf([FULL, BARE]) })
    expect(b.library.list).toHaveBeenCalledWith({ query: 'zT' })
  })

  it('reads one entry, and states an id the library does not hold', async () => {
    const b = await installed()
    await expect(b.view.get(FULL.id)).resolves.toEqual({ ok: true, value: FULL })
    expect(b.library.get).toHaveBeenCalledWith({ id: FULL.id })

    b.library.get.mockResolvedValueOnce({ ok: true, value: { error: 'not-found' } } as never)
    await expect(b.view.get('doi:gone')).resolves.toEqual({ ok: false, code: 'LIBRARY_NOT_FOUND' })
  })

  it('saves a patch and renders the entry the host returned, not the draft', async () => {
    const b = await installed()
    await expect(b.view.update(FULL.id, { status: 'read' })).resolves.toEqual({ ok: true, value: FULL })
    expect(b.library.update).toHaveBeenCalledWith({ id: FULL.id, patch: { status: 'read' } })

    b.library.update.mockResolvedValueOnce({ ok: true, value: { error: 'not-found' } } as never)
    await expect(b.view.update('doi:gone', { status: 'read' }))
      .resolves.toEqual({ ok: false, code: 'LIBRARY_NOT_FOUND' })
  })

  it('removes an entry together with its files', async () => {
    const b = await installed()
    await expect(b.view.remove(FULL.id)).resolves.toEqual({ ok: true, value: null })
    // A user removing an entry means its PDFs too: bytes left behind would be
    // unreachable from every surface.
    expect(b.library.remove).toHaveBeenCalledWith({ id: FULL.id, deleteFiles: true })

    b.library.remove.mockResolvedValueOnce({ ok: true, value: { removed: false, filesCleared: 0 } } as never)
    await expect(b.view.remove('doi:gone')).resolves.toEqual({ ok: false, code: 'LIBRARY_NOT_FOUND' })
  })

  it('draws a related list the host cannot compute as an empty section', async () => {
    const b = await installed()
    await expect(b.view.related(FULL.id)).resolves.toEqual([BARE])

    b.library.related.mockRejectedValueOnce(new Error('socket closed'))
    await expect(b.view.related(FULL.id)).resolves.toEqual([])
  })

  it('fetches a PDF and states the host reason when it cannot', async () => {
    const b = await installed()
    await expect(b.view.fetchPdf(FULL.id)).resolves.toEqual({ ok: true, value: FULL })

    b.library.fetchPdf.mockResolvedValueOnce({ ok: true, value: { error: 'PDF_NOT_PDF' } } as never)
    await expect(b.view.fetchPdf(FULL.id)).resolves.toEqual({ ok: false, code: 'PDF_NOT_PDF' })
  })

  it('folds an error envelope and a rejected call into stated codes', async () => {
    const b = await installed()
    const refusal = { ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: 'no domain' } }
    b.library.list.mockResolvedValueOnce(refusal as never)
    await expect(b.view.list({})).resolves.toEqual({ ok: false, code: 'STORAGE_UNAVAILABLE' })

    // The write and fetch calls pass a host refusal through unshaped too.
    b.library.update.mockResolvedValueOnce(refusal as never)
    await expect(b.view.update(FULL.id, {})).resolves.toEqual({ ok: false, code: 'STORAGE_UNAVAILABLE' })
    b.library.remove.mockResolvedValueOnce(refusal as never)
    await expect(b.view.remove(FULL.id)).resolves.toEqual({ ok: false, code: 'STORAGE_UNAVAILABLE' })
    b.library.fetchPdf.mockResolvedValueOnce(refusal as never)
    await expect(b.view.fetchPdf(FULL.id)).resolves.toEqual({ ok: false, code: 'STORAGE_UNAVAILABLE' })

    // A call that never reached an answer would otherwise surface as an
    // unhandled rejection inside the view's click chain.
    b.library.list.mockRejectedValueOnce(new Error('socket closed'))
    await expect(b.view.list({})).resolves.toEqual({ ok: false, code: 'LIBRARY_REMOTE_FAILED' })
  })

  it('reports an absent namespace as data, never as a rejected promise', async () => {
    const b = await installed({ mounts: false })
    expect(b.ctx.get(NAMESPACE)).toBeUndefined()

    await expect(b.view.list({})).resolves.toEqual({ ok: false, code: 'LIBRARY_REMOTE_UNAVAILABLE' })
    await expect(b.view.get(FULL.id)).resolves.toEqual({ ok: false, code: 'LIBRARY_REMOTE_UNAVAILABLE' })
    await expect(b.view.related(FULL.id)).resolves.toEqual([])
    expect(b.library.list).not.toHaveBeenCalled()
  })
})

describe('the injected view face over the /library-api routes', () => {
  /** One file as an input picker hands it over. */
  const UPLOAD = new File(['%PDF-1.7'], 'snse.pdf', { type: 'application/pdf' })

  it('posts one multipart file and renders the entry the route returned', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, entry: FULL })))
    vi.stubGlobal('fetch', fetchMock)
    const b = await installed()

    await expect(b.view.upload({ entryId: FULL.id, kind: 'paper', file: UPLOAD }))
      .resolves.toEqual({ ok: true, entry: FULL })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`/library-api/upload?entryId=${encodeURIComponent(FULL.id)}&kind=paper`)
    expect(init.method).toBe('POST')
    expect((init.body as FormData).get('file')).toBeInstanceOf(File)
  })

  it('states the route refusals the picker has copy for', async () => {
    const fetchMock = vi.fn(async () => new Response('too big', { status: 413 }))
    vi.stubGlobal('fetch', fetchMock)
    const b = await installed()
    await expect(b.view.upload({ entryId: 'new', kind: 'dataset', file: UPLOAD }))
      .resolves.toEqual({ ok: false, code: 'too-large' })

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(b.view.upload({ entryId: 'new', kind: 'dataset', file: UPLOAD }))
      .resolves.toEqual({ ok: false, code: 'failed' })
  })

  it('reads a stored text file, and states the status of one it cannot', async () => {
    const fetchMock = vi.fn(async () => new Response('a,b\n1,2\n'))
    vi.stubGlobal('fetch', fetchMock)
    const b = await installed()
    await expect(b.view.readText(FULL.id, 'grain.csv')).resolves.toEqual({ ok: true, text: 'a,b\n1,2\n' })
    expect(fetchMock).toHaveBeenCalledWith(
      `/library-api/file?entryId=${encodeURIComponent(FULL.id)}&name=grain.csv`,
    )

    fetchMock.mockResolvedValueOnce(new Response('gone', { status: 404 }))
    await expect(b.view.readText(FULL.id, 'gone.csv'))
      .resolves.toEqual({ ok: false, code: 'LIBRARY_FILE_HTTP_404' })

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(b.view.readText(FULL.id, 'grain.csv'))
      .resolves.toEqual({ ok: false, code: 'LIBRARY_FILE_UNREACHABLE' })
  })
})

describe('the injected add face on ②\'s cards', () => {
  it('seeds the stored ids from the host once, on the first action mount', async () => {
    const b = await installed()
    b.actionFace()
    await vi.waitFor(() => {
      expect(b.setStored).toHaveBeenCalledWith([FULL.id, BARE.id])
    })
    // The seed reads the most recently updated page the host caps at.
    expect(b.library.list).toHaveBeenCalledWith({ limit: 100 })

    // A second mount trusts the store the view keeps current; re-seeding
    // would overwrite ids an add since the first mount wrote through.
    b.actionFace()
    await Promise.resolve()
    expect(b.library.list).toHaveBeenCalledTimes(1)
  })

  it('leaves the stored ids alone when the seed read fails', async () => {
    const b = await installed()
    b.library.list.mockRejectedValueOnce(new Error('socket closed'))
    b.actionFace()
    await Promise.resolve()
    await Promise.resolve()
    expect(b.setStored).not.toHaveBeenCalled()
  })

  it('adds one record and hands back the entry the host holds', async () => {
    const b = await installed()
    const record = { id: FULL.id, title: FULL.title, authors: FULL.authors, sources: FULL.sources }
    await expect(b.actionFace().add(record as never)).resolves.toEqual({ ok: true, value: FULL })
    expect(b.library.add).toHaveBeenCalledWith({ record })
  })

  it('folds an add failure into its stated code', async () => {
    const b = await installed()
    b.library.add.mockResolvedValueOnce(
      { ok: false, error: { code: 'LIBRARY_FULL', message: 'cap' } } as never,
    )
    await expect(b.actionFace().add({ id: 'doi:x' } as never))
      .resolves.toEqual({ ok: false, code: 'LIBRARY_FULL' })
  })
})

describe('package companions', () => {
  it('reserves package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(LibraryInvariant).await()).resolves.toBeDefined()
  })

  it('keeps the node half as an inert Loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
