// @vitest-environment jsdom
/**
 * The turn artifact chips end to end: the Turn-scoped hand-over fold (its
 * match/update contract and its replay determinism), the union that claims
 * the tail chain, how a path reads on a chip, and what a click does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ArtifactChips } from '../src/client/ArtifactChips.tsx'
import {
  handedOverForClosing, SCI_ARTIFACTS_KEY, sciArtifactsDefinition, type SciArtifactsTurnData,
} from '../src/client/artifacts-node.ts'
import { basename, dirname, extensionBadge, selectArtifacts } from '../src/client/artifacts-select.ts'
import type { ArtifactChipsProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const TURN = 4

/** Minimal session events in the shape the Definition matches on. */
type Event = { seq: number; type: string; data: unknown; surfaceOp?: string | undefined }

/** `turn/start` for the turn under test. */
const turnStart = (seq: number, turn = TURN): Event =>
  ({ seq, type: 'turn/start', data: { turn } })

/** `tool/call` naming a produced file in its arguments. */
const toolCall = (seq: number, callId: string, name: string, args: unknown, turn = TURN): Event =>
  ({ seq, type: 'tool/call', data: { turn, step: 1, callId, name, arguments: JSON.stringify(args) } })

/**
 * `tool/result` settling one call, successfully unless `isError`. The
 * `surfaceOp` marker is what makes it an append-origin surface event, which
 * is the only form the fold accepts — a replacement copy is model-only.
 */
const toolResult = (seq: number, callId: string, isError = false, turn = TURN): Event => ({
  seq,
  type: 'tool/result',
  surfaceOp: 'append',
  data: { turn, step: 1, message: { content: [{ isError }], source: { callId } } },
})

/** The predecessor reader the engine hands `start`; this Definition queries none. */
const reader = { previous: () => undefined } as never

/**
 * Replay a window through the Definition exactly as the engine does: match
 * every event once in ascending seq, then start or update the one Context.
 * @param events - the window, in ascending seq.
 * @returns the Turn data the Definition would publish, or null.
 */
function replay(events: readonly Event[]): SciArtifactsTurnData | null {
  let state: unknown
  const matches: { event: Event; id: string; role: string }[] = []
  for (const event of events) {
    const match = sciArtifactsDefinition.match({ ...event, ignorable: false } as never)
    if (match !== null) matches.push({ event, id: match.id, role: match.role })
  }
  for (const match of matches) {
    const context = { state } as never
    state = match.role === 'start'
      ? sciArtifactsDefinition.start(context, { event: match.event } as never, reader)
      : state === undefined
        ? undefined
        : sciArtifactsDefinition.update(context, { event: match.event } as never)
  }
  if (state === undefined) return null
  const data = sciArtifactsDefinition.buildLocationData?.({ state } as never, 'turn')
  return data === null || data === undefined ? null : (data.value as SciArtifactsTurnData)
}

describe('the hand-over fold', () => {
  it('claims only the turn boundary and the tool pair, by turn identity', () => {
    const match = (event: Event) => sciArtifactsDefinition.match({ ...event, ignorable: false } as never)
    expect(match(turnStart(1))).toEqual({ id: '4', role: 'start' })
    expect(match(toolCall(2, 'c1', 'deliver_files', {}))).toEqual({ id: '4', role: 'update' })
    expect(match(toolResult(3, 'c1'))).toEqual({ id: '4', role: 'update' })
    expect(match({ seq: 4, type: 'assistant/message', data: {} })).toBeNull()
    // A replacement copy of a settlement is model-only and never folds.
    expect(match({ ...toolResult(5, 'c1'), surfaceOp: undefined })).toBeNull()
  })

  it('records a delivered file against the settlement that produced it', () => {
    const produced = replay([
      turnStart(1),
      toolCall(2, 'c1', 'deliver_files', { files: [{ path: '/w/out/report.pdf' }] }),
      toolResult(3, 'c1'),
    ])
    expect(produced).toEqual({ produced: [{ seq: 3, path: '/w/out/report.pdf' }] })
  })

  it('records an office export the same way', () => {
    const produced = replay([
      turnStart(1),
      toolCall(2, 'c1', 'univer_export', { output: '/w/out/data.xlsx' }),
      toolResult(3, 'c1'),
    ])
    expect(produced).toEqual({ produced: [{ seq: 3, path: '/w/out/data.xlsx' }] })
  })

  it('records nothing for a failed call, an unknown tool, an unpaired settlement, or unreadable arguments', () => {
    expect(replay([
      turnStart(1),
      toolCall(2, 'c1', 'deliver_files', { files: [{ path: '/w/failed.pdf' }] }),
      toolResult(3, 'c1', true),
      // A tool that locates nothing.
      toolCall(4, 'c2', 'bash', { command: 'ls' }),
      toolResult(5, 'c2'),
      // A settlement whose call fell outside the window.
      toolResult(6, 'ghost'),
      // Arguments that name no path.
      toolCall(7, 'c3', 'deliver_files', { files: [] }),
      toolResult(8, 'c3'),
    ])).toEqual({ produced: [] })
  })

  it('stays pending until its turn boundary arrives, then folds the same way', () => {
    // An update-only tail builds no State: the engine keeps the Context and
    // an older page supplying turn/start replays it.
    expect(replay([
      toolCall(2, 'c1', 'deliver_files', { files: [{ path: '/w/a.pdf' }] }),
      toolResult(3, 'c1'),
    ])).toBeNull()
    const complete = [
      turnStart(1),
      toolCall(2, 'c1', 'deliver_files', { files: [{ path: '/w/a.pdf' }] }),
      toolResult(3, 'c1'),
    ]
    // Replaying the same window twice is identical: the fold reads only the
    // events, never live-only memory.
    expect(replay(complete)).toEqual(replay(complete))
  })

  it('preserves its state for an update it does not recognize', () => {
    const state = { turn: TURN, calls: new Map(), produced: [] }
    // The assembler only ever routes the two matched update types here, so
    // this arm is the Definition refusing to guess rather than a live path.
    const unrelated = { event: { seq: 9, type: 'turn/end', data: { turn: TURN } } }
    expect(sciArtifactsDefinition.update({ state } as never, unrelated as never)).toBe(state)
  })

  it('refuses to start on anything but its turn boundary', () => {
    expect(() => sciArtifactsDefinition.start({} as never, { event: toolCall(2, 'c1', 'bash', {}) } as never, reader))
      .toThrow(/requires turn\/start/u)
  })

  it('publishes under its own kind, which is the only key the assembler accepts', () => {
    const state = { turn: TURN, calls: new Map(), produced: [] }
    const data = sciArtifactsDefinition.buildLocationData?.({ state } as never, 'turn')
    // conversation-assembler.ts:731-735 throws on any other key, so a Turn
    // data key and its Definition's kind are one fact, not two.
    expect(data?.key).toBe(sciArtifactsDefinition.kind)
    expect(data?.key).toBe(SCI_ARTIFACTS_KEY)
  })

  it('publishes on the turn scope only', () => {
    const state = { turn: TURN, calls: new Map(), produced: [] }
    expect(sciArtifactsDefinition.buildLocationData?.({ state } as never, 'step')).toBeNull()
    expect(sciArtifactsDefinition.buildLocationData?.({ state: undefined } as never, 'turn')).toBeNull()
  })
})

describe('the hand-over reading', () => {
  it('keeps first-seen order and one entry per path, up to the closing seq', () => {
    const data: SciArtifactsTurnData = {
      produced: [
        { seq: 3, path: '/w/a.pdf' },
        { seq: 4, path: '/w/b.pdf' },
        { seq: 5, path: '/w/a.pdf' },
        { seq: 300, path: '/w/late.pdf' },
      ],
    }
    expect(handedOverForClosing(data, 100)).toEqual(['/w/a.pdf', '/w/b.pdf'])
    expect(handedOverForClosing(data)).toEqual(['/w/a.pdf', '/w/b.pdf', '/w/late.pdf'])
    expect(handedOverForClosing(undefined)).toEqual([])
  })
})

describe('the tail claim', () => {
  /** A turn-tail owner whose Turn published either reading, or neither. */
  function owner(
    mutations: readonly { seq: number; path: string }[] | undefined,
    handOvers: readonly { seq: number; path: string }[] | undefined,
    seq = 100,
  ): TurnTailOwnerProps {
    return {
      turn: {
        data: {
          get: (key: string) => {
            if (key === 'deliverables') return mutations === undefined ? undefined : { produced: mutations }
            if (key === SCI_ARTIFACTS_KEY) return handOvers === undefined ? undefined : { produced: handOvers }
            return undefined
          },
        },
      },
      seq,
      openFile: () => {},
    } as unknown as TurnTailOwnerProps
  }

  it('claims a turn that only wrote files', () => {
    expect(selectArtifacts(owner([{ seq: 10, path: '/w/report.md' }], []))).toEqual(['/w/report.md'])
  })

  it('claims a turn that only handed files over — the gap the mutation reading leaves', () => {
    expect(selectArtifacts(owner([], [{ seq: 12, path: '/w/out/report.pdf' }])))
      .toEqual(['/w/out/report.pdf'])
  })

  it('unions both readings, mutations first, each path once', () => {
    expect(selectArtifacts(owner(
      [{ seq: 10, path: '/w/report.md' }, { seq: 11, path: '/w/data.xlsx' }],
      [{ seq: 12, path: '/w/data.xlsx' }, { seq: 13, path: '/w/out/report.pdf' }],
    ))).toEqual(['/w/report.md', '/w/data.xlsx', '/w/out/report.pdf'])
  })

  it('declines a turn that produced nothing, and one with no Turn data at all', () => {
    expect(selectArtifacts(owner([], []))).toBeNull()
    expect(selectArtifacts(owner(undefined, undefined))).toBeNull()
  })

  it('declines files that landed after the closing assistant, from either reading', () => {
    expect(selectArtifacts(owner([{ seq: 300, path: '/w/late.md' }], [{ seq: 301, path: '/w/late.pdf' }], 100)))
      .toBeNull()
  })
})

describe('how a path reads on a chip', () => {
  it('splits a path into its name and its directory', () => {
    expect(basename('/w/out/report.md')).toBe('report.md')
    expect(dirname('/w/out/report.md')).toBe('/w/out')
    expect(basename('report.md')).toBe('report.md')
    expect(dirname('report.md')).toBe('')
    expect(dirname('/report.md')).toBe('')
    expect(basename('C:\\w\\report.md')).toBe('report.md')
  })

  it('badges a file by its extension, capped at what the square holds', () => {
    expect(extensionBadge('/w/report.md')).toBe('MD')
    expect(extensionBadge('/w/book.xlsx')).toBe('XLSX')
    expect(extensionBadge('/w/archive.tarball')).toBe('TARB')
    expect(extensionBadge('/w/Makefile')).toBe('MAKE')
    expect(extensionBadge('/w/.env')).toBe('.ENV')
  })
})

describe('the chip row', () => {
  /** Mount the row over one claim. */
  function mount(matched: readonly string[]) {
    const locate = vi.fn()
    const props = { matched, locate, t: makeTranslate(zh) } as unknown as ArtifactChipsProps
    return { view: render(<ArtifactChips {...props} />), locate }
  }

  it('draws one chip per produced file, with its badge, name, and directory', () => {
    mount(['/w/out/report.md'])
    expect(screen.getByText(zh['artifacts.title'])).toBeTruthy()
    expect(screen.getByText('MD')).toBeTruthy()
    expect(screen.getByText('report.md')).toBeTruthy()
    // The directory is hover detail, not a second visible line.
    expect(screen.queryByText('/w/out')).toBeNull()
    expect(screen.getByTitle('/w/out/report.md')).toBeTruthy()
  })

  it('omits the directory line for a bare file name', () => {
    const { view } = mount(['report.md'])
    expect(view.container.textContent).toContain('report.md')
    expect(view.container.querySelectorAll('button')).toHaveLength(1)
  })

  it('hands the clicked path to the files mode', () => {
    const { locate } = mount(['/w/out/report.md'])
    fireEvent.click(screen.getByLabelText('在右侧打开 report.md'))
    expect(locate).toHaveBeenCalledWith('/w/out/report.md')
  })
})
