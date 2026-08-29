// The one outbound path: scheme and host allowlist, no redirect following, the
// byte cap, and how each transport failure is classified.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from './fetch-stub.ts'
import {
  LITERATURE_HOSTS,
  LiteratureError,
  MAX_RESPONSE_BYTES,
  assertAllowedUrl,
  fetchJson,
  fetchText,
  isAbortError,
} from '@deepseek-ai/dsh-sci-literature'

const OPTIONS = {
  source: 'openalex' as const,
  headers: { 'user-agent': 'camel-science/0.1 (+https://sci.camelco.de)' },
  signal: AbortSignal.timeout(5000),
}

afterEach(() => { vi.unstubAllGlobals() })

describe('assertAllowedUrl', () => {
  it.each(LITERATURE_HOSTS)('allows https on %s', (host) => {
    expect(() => { assertAllowedUrl(`https://${host}/works`, 'openalex') }).not.toThrow()
  })

  it.each([
    ['plain http', 'http://api.openalex.org/works'],
    ['a host outside the allowlist', 'https://evil.test/works'],
    ['a host that only ends with an allowed name', 'https://api.openalex.org.evil.test/works'],
    ['a file url', 'file:///etc/passwd'],
    ['a string that is not a url', 'not a url'],
  ])('refuses %s', (_case, url) => {
    expect(() => { assertAllowedUrl(url, 'openalex') }).toThrow(
      expect.objectContaining({ code: 'LITERATURE_URL_REFUSED' }),
    )
  })
})

describe('isAbortError', () => {
  it.each([
    ['an AbortError', new DOMException('stop', 'AbortError'), true],
    ['a TimeoutError', new DOMException('slow', 'TimeoutError'), true],
    ['another DOMException', new DOMException('nope', 'DataError'), false],
    ['an ordinary error', new Error('nope'), false],
  ])('classifies %s', (_case, error, expected) => {
    expect(isAbortError(error)).toBe(expected)
  })
})

describe('fetchText', () => {
  it('never follows a redirect', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response('{}')))

    await fetchText('https://api.openalex.org/works', OPTIONS)

    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('error')
  })

  it('reports a non-2xx reply with the status', async () => {
    stubFetch(() => Promise.resolve(new Response('rate limited', { status: 429 })))

    await expect(fetchText('https://api.semanticscholar.org/graph/v1/paper/search', { ...OPTIONS, source: 'semanticscholar' }))
      .rejects.toThrow(expect.objectContaining({
        code: 'LITERATURE_SOURCE_HTTP',
        message: 'semanticscholar: replied HTTP 429',
      }))
  })

  it('classifies a cancelled request as an abort, not a transport failure', async () => {
    stubFetch(() => Promise.reject(new DOMException('stop', 'AbortError')))

    await expect(fetchText('https://api.openalex.org/works', OPTIONS))
      .rejects.toThrow(expect.objectContaining({ code: 'LITERATURE_ABORTED' }))
  })

  it('classifies a transport failure as a source HTTP failure', async () => {
    stubFetch(() => Promise.reject(new TypeError('fetch failed')))

    await expect(fetchText('https://api.openalex.org/works', OPTIONS))
      .rejects.toThrow(expect.objectContaining({ code: 'LITERATURE_SOURCE_HTTP' }))
  })

  it('answers an empty document for a 2xx reply with no body', async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })))

    await expect(fetchText('https://api.openalex.org/works', OPTIONS)).resolves.toBe('')
  })

  it('reads a reply that arrives in several chunks', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":'))
        controller.enqueue(new TextEncoder().encode('1}'))
        controller.close()
      },
    })
    stubFetch(() => Promise.resolve(new Response(body)))

    await expect(fetchText('https://api.openalex.org/works', OPTIONS)).resolves.toBe('{"a":1}')
  })

  it('refuses a reply that passes the byte cap instead of buffering it', async () => {
    let served = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        served += 1
        controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES))
      },
    })
    stubFetch(() => Promise.resolve(new Response(body)))

    await expect(fetchText('https://api.openalex.org/works', OPTIONS))
      .rejects.toThrow(expect.objectContaining({ code: 'LITERATURE_SOURCE_TOO_LARGE' }))
    // The stream would serve chunks forever; the cap stops the read after the
    // chunk that crossed it (plus the one the stream pulls ahead), which is
    // what makes the bound a real bound rather than a post-hoc size check.
    expect(served).toBeLessThanOrEqual(3)
  })

  it('accepts a reply exactly at the byte cap', async () => {
    stubFetch(() => Promise.resolve(new Response(new Uint8Array(MAX_RESPONSE_BYTES))))

    await expect(fetchText('https://api.openalex.org/works', OPTIONS)).resolves.toHaveLength(MAX_RESPONSE_BYTES)
  })
})

describe('fetchJson', () => {
  it('parses a JSON reply', async () => {
    stubFetch(() => Promise.resolve(new Response('{"results":[]}')))

    await expect(fetchJson('https://api.openalex.org/works', OPTIONS)).resolves.toEqual({ results: [] })
  })

  it('reports a reply that is not JSON', async () => {
    stubFetch(() => Promise.resolve(new Response('<html>maintenance</html>')))

    await expect(fetchJson('https://api.openalex.org/works', OPTIONS))
      .rejects.toThrow(expect.objectContaining({ code: 'LITERATURE_SOURCE_MALFORMED' }))
  })
})

describe('LiteratureError', () => {
  it('carries the machine-routable code beside the message', () => {
    const error = new LiteratureError('nope', 'LITERATURE_INVALID_REQUEST')
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('LITERATURE_INVALID_REQUEST')
    expect(error.name).toBe('LiteratureError')
  })
})
