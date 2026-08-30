// The reader accepts one shape and refuses everything else: one file part, one
// filename, bytes. Every extra shape a general parser would tolerate is another
// way for a browser to put bytes somewhere the entry does not describe.
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { LibraryError } from '../src/error.ts'
import {
  MULTIPART_OVERHEAD_BYTES,
  boundaryOf,
  filenameOf,
  readCappedBody,
  readSingleFileUpload,
  splitParts,
} from '../src/multipart.ts'

const BOUNDARY = '----dshBoundary'

/** One part of a hand-built multipart body. */
interface PartSpec {
  /** `name` in the Content-Disposition. */
  field: string
  /** `filename` in the Content-Disposition; omitted for a plain field. */
  filename?: string
  /** The part's content. */
  content: string | Buffer
}

/**
 * Build a multipart body by hand, so the wire format under test is the wire
 * format, not something a client library agreed with the parser about.
 * @param parts - the parts to encode.
 * @param boundary - the boundary token.
 * @returns the body bytes.
 */
export function multipartBody(parts: readonly PartSpec[], boundary = BOUNDARY): Buffer {
  const chunks: Buffer[] = []
  for (const part of parts) {
    const disposition = part.filename === undefined
      ? `form-data; name="${part.field}"`
      : `form-data; name="${part.field}"; filename="${part.filename}"`
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\nContent-Type: application/octet-stream\r\n\r\n`))
    chunks.push(typeof part.content === 'string' ? Buffer.from(part.content) : part.content)
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return Buffer.concat(chunks)
}

/**
 * @param body - the body to stream.
 * @returns a one-chunk async iterable of it.
 */
function stream(body: Buffer): AsyncIterable<Buffer> {
  return Readable.from([body]) as unknown as AsyncIterable<Buffer>
}

describe('boundaryOf', () => {
  it('reads a bare and a quoted boundary', () => {
    expect(boundaryOf('multipart/form-data; boundary=abc')).toBe('abc')
    expect(boundaryOf('multipart/form-data; boundary="a b"')).toBe('a b')
  })

  it('refuses a non-multipart content type', () => {
    expect(() => boundaryOf('application/json')).toThrow(/multipart\/form-data/)
    expect(() => boundaryOf(undefined)).toThrow(LibraryError)
  })

  it('refuses a multipart type that declares no boundary', () => {
    expect(() => boundaryOf('multipart/form-data')).toThrow(/no multipart boundary/)
    expect(() => boundaryOf('multipart/form-data; boundary=')).toThrow(/no multipart boundary/)
  })
})

describe('readCappedBody', () => {
  it('concatenates every chunk shape a request can yield', async () => {
    const iterable = Readable.from([Buffer.from('a'), new Uint8Array([98]), 'c']) as unknown as AsyncIterable<Buffer>

    expect((await readCappedBody(iterable, 10)).toString()).toBe('abc')
  })

  it('refuses as soon as the cap is passed, before the rest arrives', async () => {
    let sent = 0
    const iterable = (async function* generate() {
      for (let index = 0; index < 4; index += 1) {
        sent += 1
        yield Buffer.alloc(4)
      }
    })()

    await expect(readCappedBody(iterable, 6)).rejects.toMatchObject({ code: 'LIBRARY_TOO_LARGE' })
    expect(sent).toBe(2)
  })
})

describe('splitParts', () => {
  it('splits a two-part body and strips the trailing CRLF from each content', () => {
    const parts = splitParts(multipartBody([
      { field: 'kind', content: 'dataset' },
      { field: 'file', filename: 'a.csv', content: 'x,y\r\n1,2' },
    ]), BOUNDARY)

    expect(parts).toHaveLength(2)
    expect(parts[1]?.content.toString()).toBe('x,y\r\n1,2')
  })

  it('yields nothing for a body with no boundary in it', () => {
    expect(splitParts(Buffer.from('not multipart at all'), BOUNDARY)).toEqual([])
  })

  it('skips a part whose header block never terminates', () => {
    const malformed = Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data\r\n--${BOUNDARY}--\r\n`)

    expect(splitParts(malformed, BOUNDARY)).toEqual([])
  })

  it('stops at the closing delimiter rather than reading the epilogue', () => {
    const withEpilogue = Buffer.concat([
      multipartBody([{ field: 'file', filename: 'a.md', content: 'hi' }]),
      Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="ghost"\r\n\r\nx\r\n`),
    ])

    expect(splitParts(withEpilogue, BOUNDARY)).toHaveLength(1)
  })
})

describe('filenameOf', () => {
  it('reads a quoted, an unquoted, and an RFC 5987 encoded name', () => {
    expect(filenameOf('Content-Disposition: form-data; name="f"; filename="a b.pdf"')).toBe('a b.pdf')
    expect(filenameOf('Content-Disposition: form-data; filename=plain.pdf')).toBe('plain.pdf')
    expect(filenameOf("Content-Disposition: form-data; filename*=UTF-8''%E8%AE%BA%E6%96%87.pdf")).toBe('论文.pdf')
  })

  it('is undefined for a part carrying no file', () => {
    expect(filenameOf('Content-Disposition: form-data; name="kind"')).toBeUndefined()
    expect(filenameOf('X-Other: 1')).toBeUndefined()
  })
})

describe('readSingleFileUpload', () => {
  const contentType = `multipart/form-data; boundary=${BOUNDARY}`

  it('reads the one file, sanitizing the name and resolving the media type', async () => {
    const body = multipartBody([
      { field: 'kind', content: 'paper' },
      { field: 'file', filename: '../my report.pdf', content: '%PDF-1.7' },
    ])

    const file = await readSingleFileUpload(stream(body), contentType, 1024)

    expect(file).toEqual({
      name: 'my-report.pdf',
      mediaType: 'application/pdf',
      bytes: new Uint8Array(Buffer.from('%PDF-1.7')),
    })
  })

  it('refuses a body carrying no file part', async () => {
    const body = multipartBody([{ field: 'kind', content: 'paper' }])

    await expect(readSingleFileUpload(stream(body), contentType, 1024))
      .rejects.toMatchObject({ code: 'LIBRARY_INVALID_UPLOAD' })
  })

  it('refuses a body carrying two files, rather than silently taking one', async () => {
    const body = multipartBody([
      { field: 'a', filename: 'one.pdf', content: 'x' },
      { field: 'b', filename: 'two.pdf', content: 'y' },
    ])

    await expect(readSingleFileUpload(stream(body), contentType, 1024)).rejects.toThrow(/exactly one file/)
  })

  it('refuses an empty file', async () => {
    const body = multipartBody([{ field: 'file', filename: 'empty.pdf', content: '' }])

    await expect(readSingleFileUpload(stream(body), contentType, 1024)).rejects.toThrow(/is empty/)
  })

  it('refuses a file past the cap even when the body fitted in the headroom', async () => {
    const body = multipartBody([{ field: 'file', filename: 'big.pdf', content: Buffer.alloc(200) }])

    await expect(readSingleFileUpload(stream(body), contentType, 100))
      .rejects.toMatchObject({ code: 'LIBRARY_TOO_LARGE' })
  })

  it('refuses a body past the cap plus its multipart headroom while reading', async () => {
    const body = multipartBody([{ field: 'file', filename: 'big.pdf', content: Buffer.alloc(MULTIPART_OVERHEAD_BYTES + 200) }])

    await expect(readSingleFileUpload(stream(body), contentType, 100))
      .rejects.toMatchObject({ code: 'LIBRARY_TOO_LARGE' })
  })

  it('refuses an extension that is not allowlisted', async () => {
    const body = multipartBody([{ field: 'file', filename: 'payload.exe', content: 'MZ' }])

    await expect(readSingleFileUpload(stream(body), contentType, 1024))
      .rejects.toMatchObject({ code: 'LIBRARY_UNSUPPORTED_TYPE' })
  })
})
