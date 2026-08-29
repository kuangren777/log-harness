/**
 * Assembled-composition snapshot of what the `sci` profile's model reads back
 * from one `literature_search` call.
 *
 * Keyless by construction, like the five gate scenarios beside it: the recorded
 * output is the tool result the harness itself produced, and no model call
 * decides any assertion here. The four indexes are the one thing replaced —
 * they are third-party network services, so the scenario serves each one the
 * reply recorded under `packages/sci/sci-literature/tests/fixtures/`, which is
 * a real capture of that index answering `n-type SnSe thermoelectric`.
 * @module literature-search-snapshot
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

describe('sci-literature-search', () => {
  it('returns one merged, identifier-carrying record list from four indexes', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const source = Object.keys(REPLIES).find(name => url.includes(name))
      return Promise.resolve(source === undefined
        ? new Response('not found', { status: 404 })
        : new Response(REPLIES[source]))
    }))
    const example = await bootExample('balanced')
    booted.push(example)

    const result = await call(example, 'literature_search', {
      query: 'n-type SnSe thermoelectric',
      limit: 5,
    })

    expect(result.isError).toBeFalsy()
    const body = `${resultText(example, result)}\n---\nsci events: ${JSON.stringify(sciEvents(example), undefined, 2)}\n`
    await expect(body).toMatchFileSnapshot(
      fileURLToPath(new URL('./snapshots/sci-literature-search.txt', import.meta.url)),
    )
  }, 60_000)
})
