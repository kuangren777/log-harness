// The one session event this package appends: it rides beside the tool result
// and carries only the hit count and the failed sources.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { literatureSearchedData, recordLiteratureSearch } from '@deepseek-ai/dsh-sci-literature'
import type { LiteratureSearchResult } from '@deepseek-ai/dsh-sci-literature'

const RESULT: LiteratureSearchResult = { records: [], total: 7, sourceErrors: [], elapsedMs: 12 }

describe('literatureSearchedData', () => {
  it('reports an empty failure list when every source answered', () => {
    expect(literatureSearchedData('n-type SnSe', RESULT))
      .toEqual({ query: 'n-type SnSe', hits: 7, sourceErrors: [] })
  })

  it('names each failed source with its code', () => {
    expect(literatureSearchedData('q', {
      ...RESULT,
      sourceErrors: [
        { source: 'semanticscholar', code: 'LITERATURE_SOURCE_HTTP', message: 'x' },
        { source: 'arxiv', code: 'LITERATURE_ABORTED', message: 'y' },
      ],
    }).sourceErrors).toEqual(['semanticscholar:LITERATURE_SOURCE_HTTP', 'arxiv:LITERATURE_ABORTED'])
  })
})

describe('recordLiteratureSearch', () => {
  it('appends an ignorable record to the calling session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()

    recordLiteratureSearch(session, 'n-type SnSe', RESULT)

    const event = session.events.find(candidate => candidate.type === 'sci/literature-searched')
    expect(event?.data).toEqual({ query: 'n-type SnSe', hits: 7, sourceErrors: [] })
    expect(event?.ignorable).toBe(true)

    await ctx.fiber.dispose()
  })
})
