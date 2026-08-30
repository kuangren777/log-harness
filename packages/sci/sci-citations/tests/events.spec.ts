// The one session event this package appends, and the envelope flag that lets a
// build which does not know the type keep reading the log.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { citationsChangedData, recordCitationsChange } from '../src/events.ts'
import { PROJECT } from './fixtures.ts'

describe('citationsChangedData', () => {
  it('carries the citekey when the operation named one', () => {
    expect(citationsChangedData(PROJECT, 'add', 'zhao2015'))
      .toEqual({ project: PROJECT, op: 'add', citekey: 'zhao2015' })
  })

  it('leaves the citekey out for a project-wide change', () => {
    const data = citationsChangedData(PROJECT, 'rescan')

    expect(data).toEqual({ project: PROJECT, op: 'rescan' })
    expect(Object.hasOwn(data, 'citekey')).toBe(false)
  })
})

describe('recordCitationsChange', () => {
  it('appends the change to the session as an ignorable event', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()

    recordCitationsChange(session, PROJECT, 'add', 'zhao2015')

    const events = session.events.filter(event => event.type === 'sci/citations-changed')
    expect(events.map(event => event.data)).toEqual([{ project: PROJECT, op: 'add', citekey: 'zhao2015' }])
    expect(events[0]?.ignorable).toBe(true)

    await ctx.fiber.dispose()
  })
})
