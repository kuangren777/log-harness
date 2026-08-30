// The one session event this package appends: it rides beside the tool result
// and carries only which row changed and how.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { libraryChangedData, recordLibraryChange } from '../src/events.ts'
import { entry } from './fixtures.ts'

describe('libraryChangedData', () => {
  it('names the operation, the id, and the kind as the row stood afterwards', () => {
    expect(libraryChangedData('add', entry({ kind: 'dataset', id: 'file:abc' })))
      .toEqual({ op: 'add', id: 'file:abc', kind: 'dataset' })
  })
})

describe('recordLibraryChange', () => {
  it('appends an ignorable record to the calling session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()

    recordLibraryChange(session, 'add', entry())

    const event = session.events.find(candidate => candidate.type === 'sci/library-changed')
    expect(event?.data).toEqual({ op: 'add', id: entry().id, kind: 'paper' })
    expect(event?.ignorable).toBe(true)

    await ctx.fiber.dispose()
  })
})
