// @vitest-environment jsdom
/**
 * The plugin body: the mode registration and its disposal, the three wire
 * adapters that turn RPC and HTTP answers into the mode's plain vocabulary,
 * the office read's retry across a session the host has not attached yet, and
 * the live auto-locate watcher that brings the column forward.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry, createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationNode, ConversationSnapshot, SessionId, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { conversationSnapshot, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { DirectoryOutcome, FileReadOutcome, OfficeStateOutcome, SciFilesInjected } from '../src/client/contract.ts'
import type { ISciFiles } from '../src/client/contract.ts'
import { apply, inject } from '../src/client/index.ts'
import { createOfficeStateReader, SCOPE_ATTACH_RETRY_DELAYS_MS } from '../src/client/office-state.ts'
import { apply as nodeApply } from '../src/index.ts'
import { currentProducedPath, watchProducedFiles, type ProducedFileSessions } from '../src/client/watch-produced.ts'

// pdf.js touches DOMMatrix at import time, which jsdom lacks; the previews
// under test only need the module shape, and the pdf cases stub per test.
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(() => ({ promise: new Promise(() => {}), destroy: vi.fn() })),
}))
vi.mock('pdfjs-dist/build/pdf.worker.mjs', () => ({ WorkerMessageHandler: {} }))

// The shipped Chinese copy is what this suite asserts, so it states the
// browser locale the service reads at startup.
usePinnedBrowserLanguages('zh-CN')

const SLOT = 'conversation.details.mode'
const TOOL_SLOT = 'conversation.details.tool'
const SESSION = 's1' as SessionId

afterEach(() => { vi.unstubAllGlobals() })

/** An RPC answer in the carrier's envelope shape. */
function rpc(result: unknown): unknown {
  return { result }
}

/** A Context carrying the five services the plugin injects, with fake wire calls. */
async function bench(sessions?: ProducedFileSessions) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const listDirectory = vi.fn(async () => rpc({ ok: true, value: { path: '/p', entries: [] } }))
  const readFile = vi.fn(async () => rpc({ ok: true, value: { path: '/p/a.md', size: 1, mediaType: 'text/markdown', encoding: 'utf8', content: 'x' } }))
  ctx.provide('connection', { api: { workspace: { listDirectory, readFile } } } as never)
  const showDetailsMode = vi.fn()
  const closeDetails = vi.fn()
  ctx.provide('layout', { showDetailsMode, closeDetails } as never)
  const list = createSnapshotStore<SessionListState>({ current: undefined } as SessionListState)
  ctx.provide('sessions', sessions ?? { list, binding: () => undefined } as never)
  const slots = ctx.get('slots') as SlotRegistry
  const declare = () => slots.register({
    name: 'root',
    children: {
      [SLOT]: { kind: 'list', scope: 'session' },
      [TOOL_SLOT]: { kind: 'single', scope: 'session' },
    },
  } as never, () => null)
  return { ctx, slots, declare, listDirectory, readFile, showDetailsMode, closeDetails }
}

/** The injected face of the installed entry. */
function faceOf(slots: SlotRegistry): SciFilesInjected {
  const entry = slots.entries(SLOT)[0]
  return (entry?.inject as unknown as () => SciFilesInjected)()
}

describe('ui-sci-files plugin body', () => {
  it('declares the services it drives', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'layout', 'sessions'])
  })

  it('installs the Files mode whether the strip is declared before or after apply, and leaves with its fiber', async () => {
    const before = await bench()
    before.declare()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(before.slots.entries(SLOT)).toHaveLength(1)
    // Registry-contribution disposal proof: the fiber going down empties the strip.
    await fiber.dispose()
    expect(before.slots.entries(SLOT)).toHaveLength(0)

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries(SLOT)).toHaveLength(0)
    after.declare()
    await Promise.resolve()
    expect(after.slots.entries(SLOT)).toHaveLength(1)
  })

  it('labels the tab from its own dictionary', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries(SLOT)[0]
    expect(entry?.options.id).toBe('files')
    expect((entry?.options.label as () => string)()).toBe('文件')
  })

  it('adapts a session-scoped directory level, carrying every entry kind through', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = faceOf(b.slots)

    b.listDirectory.mockResolvedValueOnce(rpc({
      ok: true,
      value: {
        path: '/p',
        entries: [
          { name: 'src', path: '/p/src', kind: 'directory' },
          { name: 'notes.md', path: '/p/notes.md', kind: 'file', size: 12 },
          { name: 'daemon.sock', path: '/p/daemon.sock', kind: 'other' },
        ],
      },
    }))
    await expect(face.listDirectory(SESSION, '/p')).resolves.toEqual({
      ok: true,
      entries: [
        { name: 'src', path: '/p/src', kind: 'directory' },
        { name: 'notes.md', path: '/p/notes.md', kind: 'file' },
        { name: 'daemon.sock', path: '/p/daemon.sock', kind: 'other' },
      ],
    } satisfies DirectoryOutcome)
    expect(b.listDirectory).toHaveBeenCalledWith({ sessionId: SESSION, path: '/p' })
  })

  it('keeps the listing codes it has copy for, and folds the rest into internal', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = faceOf(b.slots)

    b.listDirectory.mockResolvedValueOnce(rpc({
      ok: false, error: { code: 'too-many-entries', message: '', details: {} },
    }))
    await expect(face.listDirectory(SESSION, '/p')).resolves.toEqual({ ok: false, code: 'too-many-entries' })

    b.listDirectory.mockResolvedValueOnce(rpc({
      ok: false, error: { code: 'not-a-directory', message: '', details: {} },
    }))
    await expect(face.listDirectory(SESSION, '/p/a.md')).resolves.toEqual({ ok: false, code: 'not-a-directory' })

    // A code this mode has no copy for still produces a stated failure.
    b.listDirectory.mockResolvedValueOnce(rpc({
      ok: false, error: { code: 'transport-failed', message: '', details: {} },
    }))
    await expect(face.listDirectory(SESSION, '/p')).resolves.toEqual({ ok: false, code: 'internal' })
  })

  it('adapts a read, keeps the codes it has copy for, and folds the rest into internal', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = faceOf(b.slots)

    await expect(face.readFile(SESSION, '/p/a.md')).resolves.toEqual({
      ok: true,
      file: { path: '/p/a.md', size: 1, mediaType: 'text/markdown', encoding: 'utf8', content: 'x' },
    } satisfies FileReadOutcome)
    expect(b.readFile).toHaveBeenCalledWith({ sessionId: SESSION, path: '/p/a.md' })

    b.readFile.mockResolvedValueOnce(rpc({ ok: false, error: { code: 'file-too-large', message: '', details: {} } }))
    await expect(face.readFile(SESSION, '/p/big.bin')).resolves.toEqual({ ok: false, code: 'file-too-large' })

    // A code this mode has no copy for still produces a stated failure.
    b.readFile.mockResolvedValueOnce(rpc({ ok: false, error: { code: 'transport-failed', message: '', details: {} } }))
    await expect(face.readFile(SESSION, '/p/a.md')).resolves.toEqual({ ok: false, code: 'internal' })
  })

  it('adapts the office runtime answer, and its two ways of not answering', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = faceOf(b.slots)

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ viewerUrl: '/univer-gw/?file=x', gatewayRunning: true }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(face.officeState(SESSION, '/p/w/b.univer')).resolves.toEqual({
      ok: true, viewerUrl: '/univer-gw/?file=x', gatewayRunning: true,
    } satisfies OfficeStateOutcome)
    expect(fetchMock).toHaveBeenCalledWith('/univer-api/state?file=%2Fp%2Fw%2Fb.univer&sessionId=s1')

    // A runtime that answers without a target or a Gateway.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
    await expect(face.officeState(SESSION, '/p/w/b.univer')).resolves.toEqual({
      ok: true, viewerUrl: null, gatewayRunning: false,
    })

    // The route rejected the request (no office plugin composed).
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ code: 'NOT_FOUND' }) })))
    await expect(face.officeState(SESSION, '/p/w/b.univer')).resolves.toEqual({ ok: false })

    // The route could not be reached at all.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(face.officeState(SESSION, '/p/w/b.univer')).resolves.toEqual({ ok: false })

    // A body that is not a JSON object at all.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => 'not an object' })))
    await expect(face.officeState(SESSION, '/p/w/b.univer')).resolves.toEqual({ ok: false })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => null })))
    await expect(face.officeState(SESSION, '/p/w/b.univer')).resolves.toEqual({ ok: false })
  })

  it('refuses a viewerUrl that is not a same-origin Viewer path', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = faceOf(b.slots)

    const hostile = [
      'javascript:alert(document.domain)',
      'data:text/html,<script>alert(1)</script>',
      'https://evil.example/univer-gw/?file=a',
      '//evil.example/univer-gw/?file=a',
      // Same-origin, but not the Viewer's prefix — and the traversal form
      // that only the parsed pathname catches.
      '/api/session.list',
      '/univer-gw/../evil/page.html',
      // Not a string at all.
      42,
      { href: '/univer-gw/?file=a' },
      // A reference that does not parse even against a base.
      'http://',
    ]
    for (const viewerUrl of hostile) {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true, json: async () => ({ viewerUrl, gatewayRunning: true }),
      })))
      await expect(face.officeState(SESSION, '/p/w/b.univer')).resolves.toEqual({
        ok: true, viewerUrl: null, gatewayRunning: true,
      })
    }
  })

  it('accepts the Viewer path the office runtime actually emits, canonically', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = faceOf(b.slots)

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ viewerUrl: '/univer-gw/?file=%2Fp%2Fw%2Fb.univer#unit', gatewayRunning: true }),
    })))
    await expect(face.officeState(SESSION, '/p/w/b.univer')).resolves.toEqual({
      ok: true, viewerUrl: '/univer-gw/?file=%2Fp%2Fw%2Fb.univer#unit', gatewayRunning: true,
    })
  })

  it('never grants editing on a non-boolean gatewayRunning', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = faceOf(b.slots)

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ viewerUrl: '/univer-gw/?file=a', gatewayRunning: 'yes' }),
    })))
    await expect(face.officeState(SESSION, '/p/w/b.univer')).resolves.toEqual({
      ok: true, viewerUrl: '/univer-gw/?file=a', gatewayRunning: false,
    })
  })
})

/** An office-state read whose retry waits are instant. */
const instantReader = () => createOfficeStateReader([0, 0, 0])

/** A `/univer-api/state` rejection naming the session the host has not attached yet. */
function scopeUnavailable(): unknown {
  return {
    ok: false,
    json: async () => ({
      ok: false, code: 'SESSION_SCOPE_UNAVAILABLE', message: 'session is unavailable or has no workspace',
    }),
  }
}

/** A runtime answer carrying a Viewer target and a live Gateway. */
function attached(): unknown {
  return { ok: true, json: async () => ({ viewerUrl: '/univer-gw/?file=x', gatewayRunning: true }) }
}

/** A fetch double answering one queued response per call, then repeating the last. */
function fetchQueue(...answers: readonly unknown[]) {
  let call = 0
  const mock = vi.fn(async () => {
    const answer = answers[Math.min(call, answers.length - 1)]
    call += 1
    return answer
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('office state read', () => {
  it('waits out a session the host has not attached yet, and answers as soon as it lands', async () => {
    const fetchMock = fetchQueue(scopeUnavailable(), attached())
    await expect(instantReader()(SESSION, '/p/w/b.univer')).resolves.toEqual({
      ok: true, viewerUrl: '/univer-gw/?file=x', gatewayRunning: true,
    } satisfies OfficeStateOutcome)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('still answers when the attach lands on the last read of the schedule', async () => {
    const fetchMock = fetchQueue(scopeUnavailable(), scopeUnavailable(), scopeUnavailable(), attached())
    await expect(instantReader()(SESSION, '/p/w/b.univer')).resolves.toEqual({
      ok: true, viewerUrl: '/univer-gw/?file=x', gatewayRunning: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('states the runtime unavailable once the attach schedule is spent', async () => {
    const fetchMock = fetchQueue(scopeUnavailable())
    await expect(instantReader()(SESSION, '/p/w/b.univer')).resolves.toEqual({ ok: false })
    // One read per schedule entry, plus the first: the reader never loops on.
    expect(fetchMock).toHaveBeenCalledTimes(SCOPE_ATTACH_RETRY_DELAYS_MS.length + 1)
  })

  it('reads once for a rejection that is the runtime own answer', async () => {
    const rejected = fetchQueue({ ok: false, json: async () => ({ ok: false, code: 'INVALID_FILE_PATH' }) })
    await expect(instantReader()(SESSION, '/p/w/b.univer')).resolves.toEqual({ ok: false })
    expect(rejected).toHaveBeenCalledTimes(1)

    // A rejection body that carries no code at all is equally final.
    const bodiless = fetchQueue({ ok: false, json: async () => null })
    await expect(instantReader()(SESSION, '/p/w/b.univer')).resolves.toEqual({ ok: false })
    expect(bodiless).toHaveBeenCalledTimes(1)
  })

  it('hands the mode its own store instance, so a locate made before the first render survives', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(faceOf(b.slots).files).toBe(faceOf(b.slots).files)
  })

  it('exposes no layout gesture of its own — the column chrome owns closing', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = faceOf(b.slots) as unknown as Record<string, unknown>
    expect(face['layout']).toBeUndefined()
  })

  it('publishes one reader identity, so the frame does not re-query on every render', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(faceOf(b.slots).officeState).toBe(faceOf(b.slots).officeState)
  })
})

describe('the tool details body', () => {
  it('shadows the built-in body, and gives the seat back with its fiber', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entries = b.slots.entries(TOOL_SLOT)
    expect(entries).toHaveLength(1)
    // Lower than the built-in registration's default 0, so this one renders.
    expect(entries[0]?.options.priority).toBe(-10)
    await fiber.dispose()
    expect(b.slots.entries(TOOL_SLOT)).toHaveLength(0)
  })
})

describe('the locate service', () => {
  it('is published while the plugin is loaded, and withdrawn with it', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.ctx.get('sciFiles')).toBeDefined()
    await fiber.dispose()
    expect(b.ctx.get('sciFiles')).toBeUndefined()
  })

  it('pins the path and brings the files mode forward', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const service = b.ctx.get('sciFiles') as ISciFiles

    service.locate('/p/d/report.pdf')
    expect(faceOf(b.slots).files.getSnapshot().pinned).toEqual({ path: '/p/d/report.pdf', over: null })
    expect(b.showDetailsMode).toHaveBeenCalledWith('files')
  })

  it('records the pin against what the session has already produced', async () => {
    const world = fakeSessions()
    world.open(SESSION, [producedNode('/p/out/latest.xlsx')])
    world.setCurrent(SESSION)
    const b = await bench(world.sessions)
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const service = b.ctx.get('sciFiles') as ISciFiles

    service.locate('/p/d/report.pdf')
    expect(faceOf(b.slots).files.getSnapshot().pinned)
      .toEqual({ path: '/p/d/report.pdf', over: '/p/out/latest.xlsx' })
  })

  it('lands the pin before anything has rendered, so a locate into a closed column keeps it', async () => {
    // No declare(): the details column has no strip and the mode never
    // mounted, which is exactly the state a chip click arrives in.
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const service = b.ctx.get('sciFiles') as ISciFiles
    service.locate('/p/d/report.pdf')

    b.declare()
    await Promise.resolve()
    expect(faceOf(b.slots).files.getSnapshot().pinned).toEqual({ path: '/p/d/report.pdf', over: null })
  })
})

describe('current produced file', () => {
  it('reads the newest produced file of the current session', () => {
    const world = fakeSessions()
    world.open(SESSION, [producedNode('/p/out/a.xlsx'), producedNode('/p/out/b.xlsx')])
    world.setCurrent(SESSION)
    expect(currentProducedPath(world.sessions)).toBe('/p/out/b.xlsx')
  })

  it('reads nothing while no session is current, or before one is assembled', () => {
    const world = fakeSessions()
    expect(currentProducedPath(world.sessions)).toBeUndefined()
    world.setCurrent(SESSION)
    expect(currentProducedPath(world.sessions)).toBeUndefined()
  })
})

describe('ui-sci-files node half', () => {
  it('is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})

/** A settled successful call of one locating tool. */
function producedNode(path: string): ConversationNode {
  return {
    kind: 'tool-result', seq: 1, time: 0, callId: 'c1',
    call: { name: 'univer_export', argsRaw: JSON.stringify({ output: path }) },
    callTime: null, content: [], isError: false, callView: null, resultView: null, subCalls: [],
  }
}

/** A sessions double with a controllable current id and per-session snapshots. */
function fakeSessions() {
  const list = createSnapshotStore<SessionListState>({ current: undefined } as SessionListState)
  const stores = new Map<SessionId, ReturnType<typeof createSnapshotStore<ConversationSnapshot>>>()
  const sessions: ProducedFileSessions = {
    list,
    binding: (id) => {
      const store = stores.get(id)
      return store === undefined ? undefined : { session: store }
    },
  }
  return {
    sessions,
    open: (id: SessionId, nodes: readonly ConversationNode[] = []) => {
      stores.set(id, createSnapshotStore<ConversationSnapshot>({ ...conversationSnapshot(id), nodes }))
    },
    setCurrent: (id: SessionId | undefined) => { list.set({ current: id } as SessionListState) },
    produce: (id: SessionId, nodes: readonly ConversationNode[]) => {
      const store = stores.get(id)
      store?.set({ ...store.getSnapshot(), nodes })
    },
  }
}

describe('auto-locate watcher', () => {
  it('reports nothing while no session is current', () => {
    const world = fakeSessions()
    const onProduced = vi.fn()
    const stop = watchProducedFiles(world.sessions, onProduced)
    world.setCurrent(undefined)
    expect(onProduced).not.toHaveBeenCalled()
    stop()
  })

  it('retries a current session that is not assembled yet', () => {
    const world = fakeSessions()
    const onProduced = vi.fn()
    const stop = watchProducedFiles(world.sessions, onProduced)
    // Current, but no binding: nothing to follow, and no crash.
    world.setCurrent(SESSION)
    expect(onProduced).not.toHaveBeenCalled()
    // Assembled now; the next list change picks it up.
    world.open(SESSION)
    world.setCurrent(SESSION)
    world.produce(SESSION, [producedNode('/p/out/a.xlsx')])
    expect(onProduced).toHaveBeenCalledTimes(1)
    stop()
  })

  it('treats what a session already produced as history, not as an event', () => {
    const world = fakeSessions()
    world.open(SESSION, [producedNode('/p/out/old.xlsx')])
    world.setCurrent(SESSION)
    const onProduced = vi.fn()
    const stop = watchProducedFiles(world.sessions, onProduced)
    // The baseline was taken at follow time; a redundant list change and an
    // unrelated snapshot change both stay quiet.
    world.setCurrent(SESSION)
    world.produce(SESSION, [producedNode('/p/out/old.xlsx')])
    expect(onProduced).not.toHaveBeenCalled()
    world.produce(SESSION, [producedNode('/p/out/new.xlsx')])
    expect(onProduced).toHaveBeenCalledTimes(1)
    stop()
  })

  it('stays quiet when the window loses its last producing call', () => {
    const world = fakeSessions()
    world.open(SESSION, [producedNode('/p/out/a.xlsx')])
    world.setCurrent(SESSION)
    const onProduced = vi.fn()
    const stop = watchProducedFiles(world.sessions, onProduced)
    world.produce(SESSION, [])
    expect(onProduced).not.toHaveBeenCalled()
    stop()
  })

  it('follows the session the user switches to, from that session own baseline', () => {
    const other = 's2' as SessionId
    const world = fakeSessions()
    world.open(SESSION)
    world.open(other, [producedNode('/p/out/other.xlsx')])
    world.setCurrent(SESSION)
    const onProduced = vi.fn()
    const stop = watchProducedFiles(world.sessions, onProduced)

    world.setCurrent(other)
    expect(onProduced).not.toHaveBeenCalled()
    world.produce(other, [producedNode('/p/out/other-2.xlsx')])
    expect(onProduced).toHaveBeenCalledTimes(1)
    // The session left behind no longer reports.
    world.produce(SESSION, [producedNode('/p/out/left-behind.xlsx')])
    expect(onProduced).toHaveBeenCalledTimes(1)
    stop()
  })

  it('stops reporting once disposed', () => {
    const world = fakeSessions()
    world.open(SESSION)
    world.setCurrent(SESSION)
    const onProduced = vi.fn()
    watchProducedFiles(world.sessions, onProduced)()
    world.produce(SESSION, [producedNode('/p/out/a.xlsx')])
    world.setCurrent(undefined)
    expect(onProduced).not.toHaveBeenCalled()
  })

  it('brings the column forward through the layout face when a file lands', async () => {
    const world = fakeSessions()
    world.open(SESSION)
    world.setCurrent(SESSION)
    const b = await bench(world.sessions)
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    world.produce(SESSION, [producedNode('/p/out/a.xlsx')])
    expect(b.showDetailsMode).toHaveBeenCalledWith('files')
    // The watcher is an effect: the fiber going down detaches it.
    await fiber.dispose()
    world.produce(SESSION, [producedNode('/p/out/b.xlsx')])
    expect(b.showDetailsMode).toHaveBeenCalledTimes(1)
  })
})
