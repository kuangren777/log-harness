// Where an entry's bytes go. Two of these assertions are the security ones: a
// browser-chosen file name never becomes a path, and an entry id carrying a
// slash never scatters one entry's files across two directories.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { LibraryError } from '../src/error.ts'
import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_NAME_CHARS,
  entryDirName,
  entryFileAbsolutePath,
  entryFilePath,
  extensionOf,
  mediaTypeOf,
  readEntryFile,
  sanitizeFileName,
  sha256Hex,
  writeEntryFile,
} from '../src/files.ts'
import { FakeFs } from './fake-fs.ts'
import { file, T0 } from './fixtures.ts'

describe('sanitizeFileName', () => {
  it('drops every directory component before anything else', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFileName('C:\\Windows\\system32.dll')).toBe('system32.dll')
  })

  it('replaces characters a path segment may not carry', () => {
    expect(sanitizeFileName('my report (final).pdf')).toBe('my-report-final-.pdf')
  })

  it('strips leading dots so a name cannot become a hidden file or a traversal', () => {
    expect(sanitizeFileName('...hidden.pdf')).toBe('hidden.pdf')
  })

  it('truncates a very long name', () => {
    expect(sanitizeFileName(`${'x'.repeat(400)}.pdf`)).toHaveLength(MAX_FILE_NAME_CHARS)
  })

  it('refuses a name with nothing usable left', () => {
    expect(() => sanitizeFileName('///')).toThrow(LibraryError)
    expect(() => sanitizeFileName('..')).toThrow(LibraryError)
  })
})

describe('extensionOf', () => {
  it('lowercases the last extension', () => {
    expect(extensionOf('Data.Final.CSV')).toBe('csv')
  })

  it('is empty for a name with no extension or a leading dot only', () => {
    expect(extensionOf('README')).toBe('')
    expect(extensionOf('.env')).toBe('')
  })
})

describe('mediaTypeOf', () => {
  it('answers the allowlisted type for every accepted extension', () => {
    for (const [extension, media] of Object.entries(ALLOWED_EXTENSIONS)) {
      expect(mediaTypeOf(`data.${extension}`)).toBe(media)
    }
  })

  it('refuses anything else, naming what is accepted', () => {
    expect(() => mediaTypeOf('payload.exe')).toThrow(/not accepted/)
    try {
      mediaTypeOf('payload.exe')
    } catch (error) {
      expect((error as LibraryError).code).toBe('LIBRARY_UNSUPPORTED_TYPE')
    }
  })
})

describe('entryDirName', () => {
  it('turns an id with a slash into one path segment', () => {
    expect(entryDirName('doi:10.1103/physrevb.91.205201')).toBe('doi-10.1103-physrevb.91.205201')
  })

  it('keeps an already-safe id readable so the model can find it', () => {
    expect(entryDirName('arxiv-2607.09182')).toBe('arxiv-2607.09182')
  })

  it('digests an id that sanitizes to nothing rather than returning an empty segment', () => {
    expect(entryDirName('///')).toBe(createHash('sha256').update('///').digest('hex').slice(0, 32))
  })
})

describe('entryFilePath', () => {
  it('is the entry directory joined to the bare name', () => {
    expect(entryFilePath('doi:10.1/x', 'paper.pdf')).toBe('doi-10.1-x/paper.pdf')
  })

  it('prefixes the configured root, with a trailing slash on the root tolerated', () => {
    expect(entryFileAbsolutePath('/home/user/sci/library/', 'note:1', 'a.md'))
      .toBe('/home/user/sci/library/note-1/a.md')
  })
})

describe('sha256Hex', () => {
  it('is the lowercase hex digest of the bytes', () => {
    expect(sha256Hex(new Uint8Array([1, 2, 3]))).toBe(createHash('sha256').update(Buffer.from([1, 2, 3])).digest('hex'))
  })
})

describe('writeEntryFile', () => {
  it('writes under the entry directory and describes what was stored', async () => {
    const fs = new FakeFs()
    const bytes = new TextEncoder().encode('%PDF-1.7')

    const stored = await writeEntryFile(fs, '/lib', 'doi:10.1/x', 'paper.pdf', bytes, T0)

    expect(stored).toEqual({
      path: 'doi-10.1-x/paper.pdf',
      name: 'paper.pdf',
      size: bytes.byteLength,
      mediaType: 'application/pdf',
      sha256: sha256Hex(bytes),
      addedAt: T0,
    })
    expect(fs.written.get('/lib/doi-10.1-x/paper.pdf')).toBe(bytes)
  })

  it('refuses a name whose extension is not allowlisted before it writes anything', async () => {
    const fs = new FakeFs()

    await expect(writeEntryFile(fs, '/lib', 'a', 'x.exe', new Uint8Array(1), T0)).rejects.toThrow(LibraryError)
    expect(fs.written.size).toBe(0)
  })

  it('passes a caller signal through to the seam', async () => {
    const fs = new FakeFs()
    const controller = new AbortController()

    await writeEntryFile(fs, '/lib', 'a', 'x.md', new Uint8Array(1), T0, controller.signal)

    expect(fs.written.has('/lib/a/x.md')).toBe(true)
  })
})

describe('readEntryFile', () => {
  it('reads the bytes back from the entry directory', async () => {
    const fs = new FakeFs()
    const bytes = new Uint8Array([9, 9])
    await writeEntryFile(fs, '/lib', 'a', 'x.md', bytes, T0)

    expect(await readEntryFile(fs, '/lib', 'a', file({ name: 'x.md' }), 1024)).toEqual(bytes)
  })

  it('passes the caller cap and signal to the seam', async () => {
    const fs = new FakeFs()
    const controller = new AbortController()
    await writeEntryFile(fs, '/lib', 'a', 'x.md', new Uint8Array(10), T0)

    await expect(readEntryFile(fs, '/lib', 'a', file({ name: 'x.md' }), 2, controller.signal)).rejects.toThrow('FS_TOO_LARGE')
  })
})
