// The one network path this package has. The model does not choose the URL —
// it comes from an index that already called it this work's open-access copy —
// but a redirect is still where a public link can turn into a private one, so
// every hop is re-checked and every refusal is pinned here.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibraryError } from '../src/error.ts'
import {
  MAX_REDIRECTS,
  checkDownloadUrl,
  fetchPdfBytes,
  isPrivateHost,
  looksLikePdf,
  readCapped,
} from '../src/fetch-bytes.ts'

const PDF = new TextEncoder().encode('%PDF-1.7\nbody')

afterEach(() => { vi.unstubAllGlobals() })

/**
 * A PDF response.
 * @param overrides - status and headers this case cares about.
 * @returns the response.
 */
function pdfResponse(overrides: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(PDF, {
    status: overrides.status ?? 200,
    headers: { 'content-type': 'application/pdf', ...overrides.headers },
  })
}

/**
 * A redirect response.
 * @param location - the destination, or null for a redirect with none.
 * @returns the response.
 */
function redirect(location: string | null): Response {
  return new Response(null, {
    status: 302,
    headers: location === null ? {} : { location },
  })
}

describe('isPrivateHost', () => {
  it.each([
    'localhost', 'app.localhost', 'gateway.internal', 'LOCALHOST.',
    '127.0.0.1', '127.9.9.9', '0.0.0.0', '10.1.2.3', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.1.1', '100.64.0.1',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fc00::1', 'fd12::1', 'fe80::1', 'fe80::1%eth0',
  ])('refuses %s', (host) => {
    expect(isPrivateHost(host)).toBe(true)
  })

  it.each(['arxiv.org', 'export.arxiv.org', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1', '::ffff:8.8.8.8'])(
    'allows %s',
    (host) => { expect(isPrivateHost(host)).toBe(false) },
  )
})

describe('checkDownloadUrl', () => {
  it('accepts a public https URL', () => {
    expect(checkDownloadUrl('https://arxiv.org/pdf/2607.09182').hostname).toBe('arxiv.org')
  })

  it('resolves a relative destination against the hop that returned it', () => {
    expect(checkDownloadUrl('/pdf/x', new URL('https://arxiv.org/abs/y')).href).toBe('https://arxiv.org/pdf/x')
  })

  it.each([
    ['http://arxiv.org/pdf/x', 'https'],
    ['ftp://arxiv.org/x', 'https'],
    ['not a url', 'usable URL'],
    ['https://user:pw@arxiv.org/x', 'credentials'],
    ['https://127.0.0.1/x', 'local or private'],
  ])('refuses %s', (url, reason) => {
    expect(() => checkDownloadUrl(url)).toThrow(new RegExp(reason))
    try {
      checkDownloadUrl(url)
    } catch (error) {
      expect((error as LibraryError).code).toBe('LIBRARY_BLOCKED_URL')
    }
  })
})

describe('readCapped', () => {
  it('reads the whole body when it fits', async () => {
    expect(await readCapped(new Response(PDF), 1024)).toEqual(PDF)
  })

  it('refuses a declared length past the cap before reading anything', async () => {
    const response = new Response(PDF, { headers: { 'content-length': '9999' } })

    await expect(readCapped(response, 10)).rejects.toThrow(/9999 bytes/)
  })

  it('refuses while reading when no length was declared', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8))
        controller.enqueue(new Uint8Array(8))
        controller.close()
      },
    })

    await expect(readCapped(new Response(stream), 10)).rejects.toThrow(/10 byte limit/)
  })

  it('answers empty for a response with no body', async () => {
    expect(await readCapped(new Response(null, { status: 204 }), 10)).toEqual(new Uint8Array(0))
  })
})

describe('looksLikePdf', () => {
  it('accepts a declared PDF content type, parameters and case included', () => {
    expect(looksLikePdf('Application/PDF; charset=binary', new Uint8Array(0))).toBe(true)
  })

  it('accepts bytes that start with the magic even when the type says otherwise', () => {
    expect(looksLikePdf('application/octet-stream', PDF)).toBe(true)
  })

  it('refuses a login page', () => {
    expect(looksLikePdf('text/html', new TextEncoder().encode('<html>sign in'))).toBe(false)
  })

  it('refuses a response with no content type and no magic', () => {
    expect(looksLikePdf(null, new Uint8Array([1, 2, 3, 4]))).toBe(false)
  })
})

describe('fetchPdfBytes', () => {
  const options = { maxBytes: 1024, timeoutMs: 1000 }

  it('downloads a PDF', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(pdfResponse())))

    expect(await fetchPdfBytes('https://arxiv.org/pdf/x', options)).toEqual(PDF)
  })

  it('refuses a non-https URL before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchPdfBytes('http://arxiv.org/pdf/x', options)).rejects.toMatchObject({ code: 'LIBRARY_BLOCKED_URL' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a private host before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchPdfBytes('https://10.0.0.1/x.pdf', options)).rejects.toMatchObject({ code: 'LIBRARY_BLOCKED_URL' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('re-checks every redirect, so a public link cannot hop to a private one', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(redirect('https://127.0.0.1/secret.pdf'))))

    await expect(fetchPdfBytes('https://arxiv.org/abs/x', options)).rejects.toMatchObject({ code: 'LIBRARY_BLOCKED_URL' })
  })

  it('follows a redirect chain inside the budget', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(redirect('https://arxiv.org/hop1'))
      .mockResolvedValueOnce(redirect('/hop2'))
      .mockResolvedValueOnce(pdfResponse())
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchPdfBytes('https://arxiv.org/abs/x', options)).toEqual(PDF)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it(`gives up past ${String(MAX_REDIRECTS)} redirects`, async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(redirect('https://arxiv.org/loop'))))

    await expect(fetchPdfBytes('https://arxiv.org/abs/x', options))
      .rejects.toMatchObject({ code: 'LIBRARY_TOO_MANY_REDIRECTS' })
  })

  it('refuses a redirect that names no destination', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(redirect(null))))

    await expect(fetchPdfBytes('https://arxiv.org/abs/x', options))
      .rejects.toMatchObject({ code: 'LIBRARY_FETCH_FAILED' })
  })

  it('reports a non-success status without the transport detail', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 403 }))))

    await expect(fetchPdfBytes('https://arxiv.org/pdf/x', options)).rejects.toThrow('the PDF link answered 403')
  })

  it('reports a refused connection as a failure to answer', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED 1.2.3.4:443'))))

    const failure = fetchPdfBytes('https://arxiv.org/pdf/x', options)

    await expect(failure).rejects.toMatchObject({ code: 'LIBRARY_FETCH_FAILED' })
    await expect(failure).rejects.not.toThrow(/1\.2\.3\.4/)
  })

  it('refuses a body past the cap', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(pdfResponse())))

    await expect(fetchPdfBytes('https://arxiv.org/pdf/x', { ...options, maxBytes: 2 }))
      .rejects.toMatchObject({ code: 'LIBRARY_TOO_LARGE' })
  })

  it('refuses a login page dressed as a PDF link', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>sign in', { headers: { 'content-type': 'text/html' } }))))

    await expect(fetchPdfBytes('https://publisher.example/pdf/x', options))
      .rejects.toMatchObject({ code: 'LIBRARY_NOT_PDF' })
  })

  it('merges a caller signal with the budget', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url: URL, init: RequestInit) => {
      controller.abort()
      return init.signal?.aborted === true
        ? Promise.reject(new Error('aborted'))
        : Promise.resolve(pdfResponse())
    }))

    await expect(fetchPdfBytes('https://arxiv.org/pdf/x', { ...options, signal: controller.signal }))
      .rejects.toMatchObject({ code: 'LIBRARY_FETCH_FAILED' })
  })
})
