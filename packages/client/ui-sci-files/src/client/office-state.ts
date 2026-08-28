/**
 * The office runtime's `/univer-api/state` read, and the one transient it
 * survives.
 *
 * The route is the office plugin's own browser API on this origin, reached
 * with `fetch` rather than the RPC carrier because that is the interface the
 * office package publishes. A deployment without the office plugin answers
 * 404, which reads the same as a Gateway that failed to start: no frame.
 *
 * One failure is not the runtime's answer but its clock. After a host restart
 * the panel can select a produced document before the host has attached that
 * session, and the route rejects with `SESSION_SCOPE_UNAVAILABLE` until the
 * attach lands — a state that clears on its own, usually within a second.
 * Only that code is retried, on the schedule the caller supplies; every other
 * failure is the runtime's actual answer and settles the read at once.
 *
 * The answer is untyped JSON on a route no RPC schema covers, so both members
 * it contributes are checked here — `gatewayRunning` grants editing and
 * `viewerUrl` becomes a frame source.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { OfficeStateOutcome } from './contract.ts'
import { VIEWER_PATH_PREFIX } from './office-url.ts'

/** The office runtime's browser API path; same origin, session-scoped by the host. */
const OFFICE_STATE_PATH = '/univer-api/state'

/** The host's rejection code for a session it has not attached yet. */
const SCOPE_UNAVAILABLE_CODE = 'SESSION_SCOPE_UNAVAILABLE'

/**
 * Waits before the retries of one not-yet-attached session, one entry per
 * retry: four reads across roughly 5.6 seconds. The span covers a session
 * attach that follows a host restart. Past it the failure is worth stating,
 * and the notice carries a retry the user drives.
 */
export const SCOPE_ATTACH_RETRY_DELAYS_MS: readonly number[] = [800, 1_600, 3_200]

/** One read attempt: the runtime's answer, or the fact that the session is not attached yet. */
type StateAttempt =
  | { readonly settled: true; readonly outcome: OfficeStateOutcome }
  | { readonly settled: false }

/**
 * The Viewer target one runtime answer may be trusted for, or null.
 *
 * This value ends up in an `<iframe src>`, which is script execution in this
 * origin, and it arrives as untyped JSON over a route no RPC schema covers —
 * so it is a wire boundary and gets validated like one. Only a same-origin
 * relative path under the Gateway's own reverse-proxy prefix is accepted:
 * `javascript:` and `data:` parse to an opaque origin, `//host` and any
 * absolute URL to a foreign one, and `/univer-gw/../evil` normalizes out of
 * the prefix. Testing the PARSED pathname rather than the raw string is what
 * closes that last one. Anything refused leaves the panel in its
 * runtime-unavailable state instead of framing a hostile document.
 * @param value - the answer's `viewerUrl` member, unvalidated.
 * @returns the canonical relative target, or null when there is none to trust.
 */
function trustedViewerUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let target: URL
  try {
    target = new URL(value, location.origin)
  } catch {
    // Not a parsable reference even against a base; there is nothing to frame.
    return null
  }
  if (target.origin !== location.origin) return null
  if (!target.pathname.startsWith(VIEWER_PATH_PREFIX)) return null
  return `${target.pathname}${target.search}${target.hash}`
}

/**
 * Whether a rejected answer names the session-attach transient.
 * @param body - the rejection body, untyped.
 * @returns true when the host reported the session as not attached yet.
 */
function scopeUnavailable(body: unknown): boolean {
  return (body as { code?: unknown } | null | undefined)?.code === SCOPE_UNAVAILABLE_CODE
}

/**
 * One `/univer-api/state` read.
 * @param sessionId - session whose project directory scopes the path.
 * @param path - the document to open.
 * @returns the runtime's answer, or the fact that the session is not attached yet.
 */
async function attemptOfficeState(sessionId: SessionId, path: string): Promise<StateAttempt> {
  const query = `file=${encodeURIComponent(path)}&sessionId=${encodeURIComponent(sessionId)}`
  try {
    const response = await fetch(`${OFFICE_STATE_PATH}?${query}`)
    const body: unknown = await response.json()
    if (!response.ok) {
      return scopeUnavailable(body) ? { settled: false } : { settled: true, outcome: { ok: false } }
    }
    if (typeof body !== 'object' || body === null) return { settled: true, outcome: { ok: false } }
    const state = body as { viewerUrl?: unknown; gatewayRunning?: unknown }
    return {
      settled: true,
      outcome: {
        ok: true,
        viewerUrl: trustedViewerUrl(state.viewerUrl),
        // Strict equality, not truthiness: a non-boolean must never grant editing.
        gatewayRunning: state.gatewayRunning === true,
      },
    }
  } catch {
    // The office runtime is not reachable (absent plugin, dropped connection,
    // a body that is not JSON); the frame states that instead of rendering an
    // empty rectangle.
    return { settled: true, outcome: { ok: false } }
  }
}

/**
 * Wait out one retry gap.
 * @param ms - the wait in milliseconds.
 * @returns a promise settling after the wait.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * The office-state reader the mode's injected face publishes: one document's
 * collaboration state and Viewer target, retried across the session-attach
 * transient and no other failure.
 * @param retryDelaysMs - waits before the retries of a not-yet-attached session, one entry per retry.
 * @returns the reader, which reports the runtime unavailable once the schedule is spent.
 */
export function createOfficeStateReader(
  retryDelaysMs: readonly number[],
): (sessionId: SessionId, path: string) => Promise<OfficeStateOutcome> {
  return async (sessionId, path) => {
    for (const delayMs of retryDelaysMs) {
      const attempt = await attemptOfficeState(sessionId, path)
      if (attempt.settled) return attempt.outcome
      await sleep(delayMs)
    }
    const last = await attemptOfficeState(sessionId, path)
    // The attach never landed within the schedule: state that, and let the
    // notice's own retry cover a host that is slower than the whole span.
    return last.settled ? last.outcome : { ok: false }
  }
}
