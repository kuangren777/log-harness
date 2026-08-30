// Every assertion here goes over a real socket: the route is the browser's only
// way to put bytes into the sandbox, so its trust fence and its status codes
// are observed through node:http rather than by calling the handler with fake
// request objects.
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibraryError } from '../src/error.ts'
import {
  FILE_PATH,
  UPLOAD_PATH,
  createLibraryRouter,
  parseKind,
  requireParam,
  statusForCode,
} from '../src/upload-route.ts'
import type { LibraryRouteHost, RequestTrustCheck } from '../src/upload-route.ts'
import { entry, file } from './fixtures.ts'
import { multipartBody } from './multipart.spec.ts'

const BOUNDARY = '----dshBoundary'
const CONTENT_TYPE = `multipart/form-data; boundary=${BOUNDARY}`
const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.close()
    await once(server, 'close')
  }
})

/**
 * Serve the router on a loopback port.
 * @param host - the route host.
 * @param isTrusted - the trust fence.
 * @returns the base URL.
 */
async function serve(host: LibraryRouteHost, isTrusted: RequestTrustCheck = () => true): Promise<string> {
  const handler = createLibraryRouter(host, isTrusted)
  const server = createServer((request, response) => { void handler(request, response) })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}

/**
 * One HTTP round trip.
 * @param base - the server's base URL.
 * @param options - method, path, headers, and body.
 * @returns the status, headers, and body text.
 */
async function call(base: string, options: {
  method: string
  path: string
  headers?: Record<string, string>
  body?: Buffer
}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  const url = new URL(options.path, base)
  const outgoing = httpRequest({
    method: options.method,
    hostname: url.hostname,
    port: url.port,
    path: `${url.pathname}${url.search}`,
    headers: options.headers ?? {},
  })
  if (options.body !== undefined) outgoing.write(options.body)
  outgoing.end()
  const [response] = await once(outgoing, 'response') as [Awaited<ReturnType<typeof httpRequest>> extends never ? never : import('node:http').IncomingMessage]
  const chunks: Buffer[] = []
  for await (const chunk of response) chunks.push(Buffer.from(chunk as Buffer))
  return {
    status: response.statusCode ?? 0,
    headers: response.headers,
    text: Buffer.concat(chunks).toString('utf8'),
  }
}

/**
 * A route host that answers happily.
 * @param overrides - the two operations this case cares about.
 * @returns the host.
 */
function host(overrides: Partial<LibraryRouteHost> = {}): LibraryRouteHost {
  return {
    maxFileBytes: 1024,
    upload: vi.fn(() => Promise.resolve(entry({ files: [file()] }))),
    download: vi.fn(() => Promise.resolve({ file: file({ name: 'paper.pdf' }), bytes: new Uint8Array([37, 80, 68, 70]) })),
    ...overrides,
  }
}

describe('statusForCode', () => {
  it.each([
    ['LIBRARY_TOO_LARGE', 413],
    ['LIBRARY_UNSUPPORTED_TYPE', 415],
    ['LIBRARY_NOT_FOUND', 404],
    ['LIBRARY_INVALID_REQUEST', 400],
    ['LIBRARY_INVALID_UPLOAD', 400],
    ['LIBRARY_BLOCKED_URL', 502],
    ['LIBRARY_NOT_PDF', 502],
  ] as const)('answers %s with %i', (code, status) => {
    expect(statusForCode(code)).toBe(status)
  })
})

describe('parseKind', () => {
  it('reads a valid kind and treats absent or empty as unset', () => {
    expect(parseKind('dataset')).toBe('dataset')
    expect(parseKind(null)).toBeUndefined()
    expect(parseKind('')).toBeUndefined()
  })

  it('refuses anything else', () => {
    expect(() => parseKind('spreadsheet')).toThrow(LibraryError)
  })
})

describe('requireParam', () => {
  it('passes a non-empty value and refuses an absent or empty one', () => {
    expect(requireParam('x', 'entryId')).toBe('x')
    expect(() => requireParam(null, 'entryId')).toThrow(/entryId is required/)
    expect(() => requireParam('', 'entryId')).toThrow(/entryId is required/)
  })
})

describe('POST /library-api/upload', () => {
  const body = multipartBody([{ field: 'file', filename: 'paper.pdf', content: '%PDF-1.7' }], BOUNDARY)

  it('stores the file and answers the entry', async () => {
    const routeHost = host()
    const base = await serve(routeHost)

    const response = await call(base, {
      method: 'POST',
      path: `${UPLOAD_PATH}?entryId=new&kind=paper`,
      headers: { 'content-type': CONTENT_TYPE },
      body,
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.text)).toMatchObject({ ok: true, entry: { id: entry().id } })
    expect(routeHost.upload).toHaveBeenCalledWith('new', 'paper', expect.objectContaining({ name: 'paper.pdf' }))
  })

  it('refuses an untrusted request before it reads the body', async () => {
    const routeHost = host()
    const base = await serve(routeHost, () => false)

    const response = await call(base, {
      method: 'POST',
      path: `${UPLOAD_PATH}?entryId=new`,
      headers: { 'content-type': CONTENT_TYPE },
      body,
    })

    expect(response.status).toBe(403)
    expect(JSON.parse(response.text)).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(routeHost.upload).not.toHaveBeenCalled()
  })

  it('answers 413 for a file past the cap', async () => {
    const base = await serve(host({ maxFileBytes: 4 }))

    const response = await call(base, {
      method: 'POST',
      path: `${UPLOAD_PATH}?entryId=new`,
      headers: { 'content-type': CONTENT_TYPE },
      body,
    })

    expect(response.status).toBe(413)
    expect(JSON.parse(response.text).code).toBe('LIBRARY_TOO_LARGE')
  })

  it('answers 415 for an extension that is not allowlisted', async () => {
    const base = await serve(host())

    const response = await call(base, {
      method: 'POST',
      path: `${UPLOAD_PATH}?entryId=new`,
      headers: { 'content-type': CONTENT_TYPE },
      body: multipartBody([{ field: 'file', filename: 'payload.exe', content: 'MZ' }], BOUNDARY),
    })

    expect(response.status).toBe(415)
    expect(JSON.parse(response.text).code).toBe('LIBRARY_UNSUPPORTED_TYPE')
  })

  it('answers 400 for a missing entryId and for an unknown kind', async () => {
    const base = await serve(host())

    const noEntry = await call(base, { method: 'POST', path: UPLOAD_PATH, headers: { 'content-type': CONTENT_TYPE }, body })
    const badKind = await call(base, {
      method: 'POST',
      path: `${UPLOAD_PATH}?entryId=new&kind=spreadsheet`,
      headers: { 'content-type': CONTENT_TYPE },
      body,
    })

    expect(noEntry.status).toBe(400)
    expect(badKind.status).toBe(400)
  })

  it('answers 404 when the named entry is not in the library', async () => {
    const base = await serve(host({
      upload: () => Promise.reject(new LibraryError('no such entry', 'LIBRARY_NOT_FOUND')),
    }))

    const response = await call(base, {
      method: 'POST',
      path: `${UPLOAD_PATH}?entryId=ghost`,
      headers: { 'content-type': CONTENT_TYPE },
      body,
    })

    expect(response.status).toBe(404)
  })

  it('answers 500 for a failure that is not the library’s own', async () => {
    const base = await serve(host({ upload: () => Promise.reject(new Error('disk on fire')) }))

    const response = await call(base, {
      method: 'POST',
      path: `${UPLOAD_PATH}?entryId=new`,
      headers: { 'content-type': CONTENT_TYPE },
      body,
    })

    expect(response.status).toBe(500)
    expect(JSON.parse(response.text).code).toBe('INTERNAL_ERROR')
  })

  it('answers 500 with a stringified reason for a non-Error rejection', async () => {
    const base = await serve(host({ upload: () => Promise.reject('nope') }))

    const response = await call(base, {
      method: 'POST',
      path: `${UPLOAD_PATH}?entryId=new`,
      headers: { 'content-type': CONTENT_TYPE },
      body,
    })

    expect(JSON.parse(response.text)).toMatchObject({ message: 'nope' })
  })
})

describe('GET /library-api/file', () => {
  it('streams the stored bytes with their media type and a filename', async () => {
    const base = await serve(host())

    const response = await call(base, { method: 'GET', path: `${FILE_PATH}?entryId=x&name=paper.pdf` })

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/pdf')
    expect(response.headers['content-disposition']).toBe('inline; filename="paper.pdf"')
    expect(response.headers['content-length']).toBe('4')
    expect(response.text).toBe('%PDF')
  })

  it('answers 400 without both parameters', async () => {
    const base = await serve(host())

    expect((await call(base, { method: 'GET', path: `${FILE_PATH}?entryId=x` })).status).toBe(400)
    expect((await call(base, { method: 'GET', path: `${FILE_PATH}?name=a.pdf` })).status).toBe(400)
  })

  it('answers 404 for a file the entry does not have', async () => {
    const base = await serve(host({
      download: () => Promise.reject(new LibraryError('no such file in the library', 'LIBRARY_NOT_FOUND')),
    }))

    expect((await call(base, { method: 'GET', path: `${FILE_PATH}?entryId=x&name=ghost.pdf` })).status).toBe(404)
  })
})

describe('unknown routes', () => {
  it('answer 404 for a request the server handed over with no url at all', async () => {
    const handler = createLibraryRouter(host(), () => true)
    const written: { status?: number } = {}
    const response = {
      writeHead: (status: number) => { written.status = status },
      end: () => {},
    } as unknown as import('node:http').ServerResponse

    await handler({ method: 'GET', headers: {} } as import('node:http').IncomingMessage, response)

    expect(written.status).toBe(404)
  })

  it('answer 404 rather than falling through to another prefix owner', async () => {
    const base = await serve(host())

    const missing = await call(base, { method: 'GET', path: '/library-api/nope' })
    const wrongMethod = await call(base, { method: 'GET', path: `${UPLOAD_PATH}?entryId=new` })

    expect(missing.status).toBe(404)
    expect(wrongMethod.status).toBe(404)
  })
})
