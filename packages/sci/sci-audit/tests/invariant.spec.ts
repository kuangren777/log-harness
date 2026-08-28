// The projection invariant, asserted over the authoritative domain-change
// stream against a real session store: a committed `sci_audit` row must name a
// log coordinate its own session really holds, because that coordinate is the
// row's key and the only thing making the live fold and the cold rebuild agree.
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import * as SciAuditInvariant from '@deepseek-ai/dsh-sci-audit/invariant'
import { validateChange } from '@deepseek-ai/dsh-sci-audit/src/invariant.ts'
import {
  AUDIT_TABLE,
  auditKey,
  auditKindSchema,
  auditRecordSchema,
  deliveryRecordSchema,
  planRecordSchema,
  sciAuditDomainSpec,
} from '@deepseek-ai/dsh-sci-audit'
import type { AuditRecord } from '@deepseek-ai/dsh-sci-audit'

const ABSENT = SessionId('00000000-0000-4000-8000-000000000000')
const DIGEST = 'b'.repeat(64)

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

/**
 * Boot a real session store and log one event into a fresh session.
 * @returns the store's context and the session carrying one logged record.
 */
async function loggedSession(): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create()
  session.append('turn/start', { turn: 1 })
  return { ctx, session }
}

/**
 * Build a put change for one audit row.
 * @param record - the committed row.
 * @returns the change event.
 */
function put(record: AuditRecord): DomainChanged {
  return {
    domain: sciAuditDomainSpec.name,
    table: AUDIT_TABLE,
    key: auditKey(record.sessionId, record.seq),
    operation: 'put',
    value: record,
  }
}

/**
 * Build a reporter that records instead of throwing, so one call site can
 * assert both the accepting and the rejecting paths.
 * @returns the reporter and the messages it has recorded.
 */
function reporter(): { fail: InvariantFailure; messages: string[] } {
  const messages: string[] = []
  const fail = ((message: string) => { messages.push(message) }) as unknown as InvariantFailure
  return { fail, messages }
}

describe('sci-audit projection invariant', () => {
  it('accepts a row projected from an event its session logged', async () => {
    const { ctx, session } = await loggedSession()
    const source = session.events[0]!
    const { fail, messages } = reporter()

    validateChange(put({
      sessionId: session.header.id, seq: source.seq, ts: source.time, kind: 'turn-end', actor: 'main',
    }), ctx.sessions, fail)

    expect(messages).toEqual([])
  })

  it('rejects a row whose seq its session never logged', async () => {
    const { ctx, session } = await loggedSession()
    const { fail, messages } = reporter()

    validateChange(put({
      sessionId: session.header.id, seq: 4096, ts: 1, kind: 'turn-end', actor: 'main',
    }), ctx.sessions, fail)

    expect(messages).toEqual([expect.stringContaining('projected from seq 4096, which session')])
  })

  it('rejects a row that carries a different time than the event it names', async () => {
    const { ctx, session } = await loggedSession()
    const source = session.events[0]!
    const { fail, messages } = reporter()

    validateChange(put({
      sessionId: session.header.id, seq: source.seq, ts: source.time + 1, kind: 'turn-end', actor: 'main',
    }), ctx.sessions, fail)

    expect(messages).toEqual([expect.stringContaining(`happened at ${source.time}`)])
  })

  it('asserts nothing about a session the store no longer holds, which is what a cold rebuild replays', async () => {
    const { ctx } = await loggedSession()
    const { fail, messages } = reporter()

    validateChange(put({ sessionId: ABSENT, seq: 1, ts: 1, kind: 'turn-end', actor: 'main' }), ctx.sessions, fail)

    expect(messages).toEqual([])
  })

  it.each([
    ['no session store is composed', undefined],
  ])('asserts nothing when %s', (_case, sessions) => {
    const { fail, messages } = reporter()

    validateChange(put({ sessionId: ABSENT, seq: 1, ts: 1, kind: 'turn-end', actor: 'main' }), sessions, fail)

    expect(messages).toEqual([])
  })

  it.each([
    ['a write to a table this package does not own', { table: 'sci_delivery' }],
    ['a write to another domain', { domain: 'sci_memory' }],
    ['a deletion', { operation: 'deleted' as const, value: undefined }],
  ])('asserts nothing about %s', async (_case, overrides) => {
    const { ctx, session } = await loggedSession()
    const { fail, messages } = reporter()
    const change = {
      ...put({ sessionId: session.header.id, seq: 4096, ts: 1, kind: 'turn-end', actor: 'main' }),
      ...overrides,
    }

    validateChange(change as DomainChanged, ctx.sessions, fail)

    expect(messages).toEqual([])
  })

  it('registers the companion against the invariant registry', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(SciAuditInvariant)).resolves.toBeDefined()
  })

  it('reports through the installed listener when a domain change arrives', async () => {
    const { ctx, session } = await loggedSession()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(SciAuditInvariant)

    const change = put({ sessionId: session.header.id, seq: 4096, ts: 1, kind: 'turn-end', actor: 'main' })

    expect(() => { ctx.emit('domain/changed', change) }).toThrow(/never logged/)
  })
})

describe('sci-audit row schemas', () => {
  it('accepts an audit row and brands its session id', () => {
    const record = {
      sessionId: ABSENT, seq: 3, ts: 17, kind: 'delivered' as const, actor: 'main',
      toolName: 'deliver_files', target: 'workspace/report.md', rule: 'file', reason: 'Report', sha256: DIGEST,
    }

    expect(auditRecordSchema.parse({ ...record })).toEqual(record)
  })

  it('rejects an audit row whose kind is outside the closed vocabulary', () => {
    expect(() => auditKindSchema.parse('teleported')).toThrow()
  })

  it('rejects an audit row whose digest is not a sha256', () => {
    expect(() => auditRecordSchema.parse({
      sessionId: ABSENT, seq: 1, ts: 1, kind: 'delivered', actor: 'main', sha256: 'nope',
    })).toThrow()
  })

  it('accepts a delivery row and rejects one without a digest', () => {
    const record = {
      deliveryId: 'd-1', sessionId: ABSENT, path: 'workspace/report.md', sha256: DIGEST,
      kind: 'file', title: 'Report', ts: 17,
    }

    expect(deliveryRecordSchema.parse({ ...record })).toEqual(record)
    expect(() => deliveryRecordSchema.parse({ ...record, sha256: '' })).toThrow()
  })

  it('accepts a plan row and rejects one without a plan id', () => {
    const record = { planId: 'p-1', sessionId: ABSENT, agentsJson: '[]', edgesJson: '[]', ts: 17 }

    expect(planRecordSchema.parse({ ...record })).toEqual(record)
    expect(() => planRecordSchema.parse({ ...record, planId: '' })).toThrow()
  })
})
