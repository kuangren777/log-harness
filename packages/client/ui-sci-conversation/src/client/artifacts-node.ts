/**
 * Turn-scoped hand-over accumulator: the files a turn gave the researcher
 * that no mutation card records.
 *
 * ui-deliverables already folds every successful mutation of a turn, by
 * render intent rather than by tool name. What it cannot see is a pure
 * hand-over: `deliver_files` gives an existing file to the user and
 * `univer_export` writes a user-facing format, and neither presents a
 * mutation card, so a turn whose only product came that way publishes no
 * Deliverables path at all. This Definition folds exactly those calls, so the
 * chip row's chain claim sees the whole of what a turn produced.
 *
 * Client-only and model-free: the vocabulary is the calls' own arguments,
 * which `locatedPath` reads, never the closing prose. The fold is a pure
 * function of the events in ascending `seq`, so a replayed window and a live
 * append reach the same Turn data.
 */
import type {
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import { locatedPath } from '@deepseek-ai/dsh-client-ui-sci-files/client'

/** One produced file and the settlement that produced it. */
interface ProducedPath {
  readonly seq: number
  readonly path: string
}

/** Immutable hand-over facts published against one Turn. */
export interface SciArtifactsTurnData {
  readonly produced: readonly ProducedPath[]
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /**
     * Hand-over and export paths accumulated in this Turn. The key is the
     * Definition's own kind because the assembler requires exactly that:
     * `conversation-assembler.ts:731-735` rejects a Location value whose key
     * is anything else, which is what makes a Turn key unambiguously owned.
     */
    'sci-artifacts': SciArtifactsTurnData
  }
}

/** The Definition's own accumulator: the open calls plus what settled so far. */
interface SciArtifactsState extends SciArtifactsTurnData {
  readonly turn: number
  /** Call head per in-flight callId; a settlement reads its arguments back here. */
  readonly calls: ReadonlyMap<string, { readonly name: string; readonly argsRaw: string }>
}

/**
 * This Definition's kind, which is also the Turn data key it publishes under.
 * One constant for both: the assembler rejects any other key, so they cannot
 * be allowed to drift.
 */
export const SCI_ARTIFACTS_KEY = 'sci-artifacts'

/**
 * The paths one Turn handed over, up to and including a closing seq.
 * @param data - engine-published hand-over data for one Turn.
 * @param seq - closing Assistant seq; later settlements are excluded.
 * @returns produced paths in first-seen order, each path once.
 */
export function handedOverForClosing(
  data: Readonly<SciArtifactsTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (data === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const produced of data.produced) {
    if (produced.seq > seq || seen.has(produced.path)) continue
    seen.add(produced.path)
    paths.push(produced.path)
  }
  return paths
}

/** Turn-local hand-over accumulator; it publishes no view Node. */
export const sciArtifactsDefinition: ConversationNodeDefinition<SciArtifactsState> = {
  kind: SCI_ARTIFACTS_KEY,
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('sci-artifacts start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), produced: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      // The call head is remembered rather than re-read at settlement: a
      // tool/result carries the outcome, never the arguments that named the
      // file, and the window normalizes both into ascending seq before replay.
      const calls = new Map(context.state.calls)
      calls.set(String(match.event.data.callId), {
        name: match.event.data.name,
        argsRaw: match.event.data.arguments,
      })
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    if (match.event.data.message.content[0].isError === true) return context.state
    const head = context.state.calls.get(String(match.event.data.message.source.callId))
    if (head === undefined) return context.state
    const path = locatedPath(head.name, head.argsRaw)
    if (path === undefined) return context.state
    return { ...context.state, produced: [...context.state.produced, { seq: match.event.seq, path }] }
  },
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined
    ? null
    : {
      kind: 'turn',
      turn: context.state.turn,
      key: SCI_ARTIFACTS_KEY,
      value: { produced: context.state.produced },
    },
}
