/**
 * Assembled-composition snapshot of what the `sci` profile's model reads back
 * from `citations_add` and the `citations_list` that follows it.
 *
 * Keyless like the scenarios beside it: the recorded output is the tool text
 * the harness itself produced, and no model call decides any assertion. The
 * four public indexes are the one thing replaced — `citations_add` with a DOI
 * resolves its metadata through `sci-literature`, so the scenario serves each
 * index the reply recorded under `packages/sci/sci-literature/tests/fixtures/`.
 *
 * Neither call names a project. That is the point of the scenario: the session
 * works inside `<projectRoot>/demo`, so the slug the citation lands under is
 * inferred from the working directory rather than stated by the model.
 * @module citations-snapshot
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootExample, call, resultText, sciEvents, seed, type BootedExample } from './harness.ts'

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

describe('sci-citations', () => {
  it('resolves a DOI into the project’s pool and reads the pool back', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const source = Object.keys(REPLIES).find(name => url.includes(name))
      return Promise.resolve(source === undefined
        ? new Response('not found', { status: 404 })
        : new Response(REPLIES[source]))
    }))
    const example = await bootExample('balanced')
    booted.push(example)
    // The bundle `citations_add` writes the bibliography into: the harness
    // creates `papers/`, and the first bundle inside it owns `refs.bib`.
    await seed(example, 'papers/p1/src/refs.bib', '')

    const added = await call(example, 'citations_add', { doi: '10.1103/physrevb.91.205201' })
    expect(added.isError).toBeFalsy()

    const listed = await call(example, 'citations_list', {})
    expect(listed.isError).toBeFalsy()

    const body = [
      resultText(example, added),
      resultText(example, listed),
      `sci events: ${JSON.stringify(sciEvents(example), undefined, 2)}`,
    ].join('\n---\n') + '\n'
    await expect(body).toMatchFileSnapshot(
      fileURLToPath(new URL('./snapshots/sci-citations.txt', import.meta.url)),
    )
  }, 60_000)
})
