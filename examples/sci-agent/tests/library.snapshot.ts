/**
 * Assembled-composition snapshot of what the `sci` profile's model reads back
 * from `library_add` and the `library_search` that follows it.
 *
 * Keyless like the scenarios beside it: the recorded output is the tool text
 * the harness itself produced, and no model call decides any assertion. The
 * four public indexes are the one thing replaced — `library_add` with a DOI
 * resolves its metadata through `sci-literature`, so the scenario serves each
 * index the reply recorded under `packages/sci/sci-literature/tests/fixtures/`.
 * @module library-snapshot
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootExample, call, resultText, sciEvents, type BootedExample } from './harness.ts'

const FIXTURES = new URL(
  '../../../packages/sci/sci-literature/tests/fixtures/',
  import.meta.url,
)

/**
 * The recorded reply of one index.
 * @param name - the fixture file name.
 * @returns the file text.
 */
function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, FIXTURES)), 'utf8')
}

const REPLIES: Readonly<Record<string, string>> = {
  openalex: fixture('openalex.json'),
  semanticscholar: fixture('semanticscholar.json'),
  arxiv: fixture('arxiv.xml'),
  crossref: fixture('crossref.json'),
}

const booted: BootedExample[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const example of booted.splice(0)) await example.dispose()
})

describe('sci-library', () => {
  it('stores a DOI-resolved entry and reads it back with the library counts', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const source = Object.keys(REPLIES).find(name => url.includes(name))
      return Promise.resolve(source === undefined
        ? new Response('not found', { status: 404 })
        : new Response(REPLIES[source]))
    }))
    const example = await bootExample('balanced')
    booted.push(example)

    const added = await call(example, 'library_add', {
      doi: '10.1103/physrevb.91.205201',
      tags: ['thermoelectric', 'snse'],
    })
    expect(added.isError).toBeFalsy()

    const found = await call(example, 'library_search', { query: 'SnSe' })
    expect(found.isError).toBeFalsy()

    const body = [
      resultText(example, added),
      resultText(example, found),
      `sci events: ${JSON.stringify(sciEvents(example), undefined, 2)}`,
    ].join('\n---\n') + '\n'
    await expect(body).toMatchFileSnapshot(
      fileURLToPath(new URL('./snapshots/sci-library.txt', import.meta.url)),
    )
  }, 60_000)
})
