// A spool entry is model-writable input, so parsing rejects every field it
// cannot trust, and a settled entry is tombstoned so the next round cannot
// deliver it twice — the filesystem seam has no unlink to do it properly.
import { describe, expect, it, vi } from 'vitest'
import {
  SPOOL_DONE,
  SPOOL_FAILED,
  SPOOL_PENDING,
  SPOOL_TOMBSTONE,
  drainSpool,
  parseSpoolEntry,
} from '@deepseek-ai/dsh-sci-deliver'
import { MemoryFileSystem, SPOOL_DIR, WORKSPACE } from './harness.ts'

const PENDING = `${SPOOL_DIR}/${SPOOL_PENDING}`

describe('parseSpoolEntry', () => {
  it('accepts the entry the sci command writes', () => {
    expect(parseSpoolEntry('{"path":"workspace/a.md","title":"A","description":"first"}')).toEqual({
      kind: 'request',
      request: { path: 'workspace/a.md', title: 'A', description: 'first' },
    })
  })

  it('accepts an entry without a description', () => {
    expect(parseSpoolEntry('{"path":"workspace/a.md","title":"A"}')).toEqual({
      kind: 'request',
      request: { path: 'workspace/a.md', title: 'A' },
    })
  })

  it('recognises the tombstone an earlier round left', () => {
    expect(parseSpoolEntry(SPOOL_TOMBSTONE)).toEqual({ kind: 'consumed' })
  })

  it.each([
    { label: 'unparseable content', text: '{ oops', reason: 'spool entry is not valid JSON:' },
    { label: 'a JSON array', text: '[]', reason: 'spool entry is not a JSON object' },
    { label: 'JSON null', text: 'null', reason: 'spool entry is not a JSON object' },
    { label: 'a JSON string', text: '"workspace/a.md"', reason: 'spool entry is not a JSON object' },
    { label: 'a missing path', text: '{"title":"A"}', reason: 'spool entry has no "path" string' },
    { label: 'a blank path', text: '{"path":"  ","title":"A"}', reason: 'spool entry has no "path" string' },
    { label: 'a missing title', text: '{"path":"workspace/a.md"}', reason: 'spool entry has no "title" string' },
    {
      label: 'a non-string description',
      text: '{"path":"workspace/a.md","title":"A","description":7}',
      reason: 'spool entry "description" is not a non-empty string',
    },
  ])('refuses $label', ({ text, reason }) => {
    const entry = parseSpoolEntry(text)
    if (entry.kind !== 'malformed') throw new Error('expected a malformed entry')
    expect(entry.reason).toContain(reason)
  })
})

describe('drainSpool', () => {
  it('delivers a well-formed entry, files it under done/, and tombstones the pending copy', async () => {
    const fs = new MemoryFileSystem().put(`${PENDING}/01.json`, '{"path":"workspace/a.md","title":"A"}')
    const deliver = vi.fn(() => Promise.resolve(undefined))
    const onFailure = vi.fn()

    await drainSpool({ spoolDir: SPOOL_DIR, fs, deliver, onFailure })

    expect(deliver).toHaveBeenCalledWith({ path: 'workspace/a.md', title: 'A' })
    expect(fs.peek(`${SPOOL_DIR}/${SPOOL_DONE}/01.json`)).toBe('{"path":"workspace/a.md","title":"A"}')
    expect(fs.peek(`${PENDING}/01.json`)).toBe(SPOOL_TOMBSTONE)
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('files a refused delivery under failed/ with its reason and reports the path it named', async () => {
    const fs = new MemoryFileSystem().put(`${PENDING}/02.json`, '{"path":"tmp/a.pdf","title":"A"}')
    const onFailure = vi.fn()

    await drainSpool({
      spoolDir: SPOOL_DIR,
      fs,
      deliver: () => Promise.resolve('tmp/a.pdf is outside the delivery area'),
      onFailure,
    })

    expect(onFailure).toHaveBeenCalledWith('tmp/a.pdf', 'tmp/a.pdf is outside the delivery area')
    const filed = JSON.parse(fs.peek(`${SPOOL_DIR}/${SPOOL_FAILED}/02.json`) ?? '') as Record<string, string>
    expect(filed['reason']).toBe('tmp/a.pdf is outside the delivery area')
    expect(filed['entry']).toBe('{"path":"tmp/a.pdf","title":"A"}')
    expect(fs.peek(`${PENDING}/02.json`)).toBe(SPOOL_TOMBSTONE)
  })

  it('reports a malformed entry against the entry file, since it named no path', async () => {
    const fs = new MemoryFileSystem().put(`${PENDING}/03.json`, '{"title":"A"}')
    const deliver = vi.fn(() => Promise.resolve(undefined))
    const onFailure = vi.fn()

    await drainSpool({ spoolDir: SPOOL_DIR, fs, deliver, onFailure })

    expect(deliver).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenCalledWith(`${PENDING}/03.json`, 'spool entry has no "path" string')
  })

  it('skips a tombstone and anything that is not a spool entry', async () => {
    const fs = new MemoryFileSystem()
      .put(`${PENDING}/04.json`, SPOOL_TOMBSTONE)
      .put(`${PENDING}/notes.txt`, 'ignored')
    const deliver = vi.fn(() => Promise.resolve(undefined))

    await drainSpool({ spoolDir: SPOOL_DIR, fs, deliver, onFailure: vi.fn() })

    expect(deliver).not.toHaveBeenCalled()
    expect(fs.paths()).toEqual([`${PENDING}/04.json`, `${PENDING}/notes.txt`])
  })

  it('does nothing when the spool has never been written', async () => {
    const fs = new MemoryFileSystem().put(`${WORKSPACE}/a.md`, 'unrelated')
    const deliver = vi.fn(() => Promise.resolve(undefined))

    await drainSpool({ spoolDir: SPOOL_DIR, fs, deliver, onFailure: vi.fn() })

    expect(deliver).not.toHaveBeenCalled()
  })
})
