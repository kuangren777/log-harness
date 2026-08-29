/** Typed replacement for `globalThis.fetch` in the adapter and runtime suites. */

import { vi } from 'vitest'
import type { Mock } from 'vitest'

/** One stubbed `fetch`, typed so the recorded calls keep their argument types. */
export type FetchStub = Mock<(input: string, init?: RequestInit) => Promise<Response>>

/**
 * Replace `globalThis.fetch` for the current test.
 * @param handler - what the stub answers; `vi.unstubAllGlobals()` removes it.
 * @returns the stub, whose `mock.calls` carry the typed request arguments.
 */
export function stubFetch(handler: (input: string, init?: RequestInit) => Promise<Response>): FetchStub {
  const mock: FetchStub = vi.fn(handler)
  vi.stubGlobal('fetch', mock)
  return mock
}

/**
 * The headers one stubbed request sent.
 * @param mock - the stub the request went through.
 * @param host - a substring of the requested URL identifying the call.
 * @returns the request headers, empty when no call matched.
 */
export function headersOf(mock: FetchStub, host: string): Headers {
  return new Headers(mock.mock.calls.find(([url]) => url.includes(host))?.[1]?.headers)
}
