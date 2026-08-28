// The commit point is what both channels share, so what is pinned here is the
// durable record it publishes: one `sci/delivered` event, ignorable, carrying
// the digest of the bytes that were actually snapshotted — and nothing at all
// when the delivery is refused.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { DeliveryId, createRecorder, randomDeliveryId } from '@deepseek-ai/dsh-sci-deliver'
import type { Recorder } from '@deepseek-ai/dsh-sci-deliver'
import {
  CANVAS_MANIFEST,
  MemoryFileSystem,
  PATHS,
  PAPER_MANIFEST,
  PROJECT,
  SNAPSHOT_DIR,
  WORKSPACE,
} from './harness.ts'

const REPORT = `${WORKSPACE}/report.md`
const PAPER = `${PROJECT}/papers/intro/intro.paper`
const CANVAS = `${WORKSPACE}/board.canvas`

/** A recorder over one in-memory filesystem, with delivery ids counted for determinism. */
function recorder(fs: MemoryFileSystem): Recorder {
  let issued = 0
  return createRecorder({
    fs,
    paths: PATHS,
    snapshotDir: SNAPSHOT_DIR,
    canvasAssetDepth: 3,
    maxDeliveryBytes: 1024,
    newDeliveryId: () => DeliveryId(`d${++issued}`),
  })
}

/** A detached session to append against. */
function session(): Session {
  return Session.create(SessionId('sci-deliver-record'))
}

describe('createRecorder', () => {
  it('snapshots the bytes and appends one ignorable sci/delivered event', async () => {
    const fs = new MemoryFileSystem().put(REPORT, '# Report\n')
    const log = session()

    const outcome = await recorder(fs)(log, { path: REPORT, title: 'Report', description: 'the findings' }, 'tool')

    expect(outcome).toEqual({
      ok: true,
      record: {
        deliveryId: 'd1',
        path: REPORT,
        title: 'Report',
        kind: 'file',
        size: 9,
        sha256: createHash('sha256').update('# Report\n').digest('hex'),
      },
    })
    const event = log.events.at(-1)
    expect(event?.type).toBe('sci/delivered')
    expect(event?.ignorable).toBe(true)
    expect(event?.data).toEqual({
      deliveryId: 'd1',
      path: REPORT,
      sha256: createHash('sha256').update('# Report\n').digest('hex'),
      size: 9,
      title: 'Report',
      description: 'the findings',
      kind: 'file',
      via: 'tool',
    })
    expect(fs.peek(`${SNAPSHOT_DIR}/d1/report.md`)).toBe('# Report\n')
  })

  it('omits description entirely when the requester gave none, and carries via', async () => {
    const fs = new MemoryFileSystem().put(REPORT, 'x')
    const log = session()

    await recorder(fs)(log, { path: REPORT, title: 'Report' }, 'spool')

    const data = log.events.at(-1)?.data as Record<string, unknown>
    expect('description' in data).toBe(false)
    expect(data['via']).toBe('spool')
  })

  it('logs nothing and writes nothing when the delivery is refused', async () => {
    const fs = new MemoryFileSystem().put(`${PROJECT}/tmp/a.pdf`, 'x')
    const log = session()

    const outcome = await recorder(fs)(log, { path: `${PROJECT}/tmp/a.pdf`, title: 'A' }, 'tool')

    if (outcome.ok) throw new Error('expected a refusal')
    expect(outcome.reason).toContain('workspace/')
    expect(log.events).toHaveLength(0)
    expect(fs.paths()).toEqual([`${PROJECT}/tmp/a.pdf`])
  })

  it('resolves a project-relative path against the session working directory', async () => {
    const fs = new MemoryFileSystem().put(REPORT, 'x')
    const id = SessionId('sci-deliver-cwd')
    const log = Session.create(id, undefined, {
      version: SESSION_FORMAT_VERSION,
      id,
      createdAt: Date.now(),
      cwd: PROJECT,
    })

    const outcome = await recorder(fs)(log, { path: 'workspace/report.md', title: 'Report' }, 'tool')

    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.record.path).toBe(REPORT)
  })

  it('reads the session log itself for the once-per-session manifest budget', async () => {
    const fs = new MemoryFileSystem().put(PAPER, PAPER_MANIFEST)
    const log = session()
    const deliver = recorder(fs)

    expect((await deliver(log, { path: PAPER, title: 'Draft' }, 'tool')).ok).toBe(true)
    const second = await deliver(log, { path: PAPER, title: 'Draft again' }, 'tool')

    if (second.ok) throw new Error('expected a refusal')
    expect(second.reason).toContain('already delivered')
    expect(log.events.filter(event => event.type === 'sci/delivered')).toHaveLength(1)
  })

  it('resolves a canvas asset reference against the manifest directory', async () => {
    const fs = new MemoryFileSystem()
      .put(CANVAS, CANVAS_MANIFEST)
      .put(`${WORKSPACE}/assets/hero.png`, 'binary-enough')
    const log = session()

    const outcome = await recorder(fs)(log, { path: CANVAS, title: 'Board' }, 'tool')

    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.record.kind).toBe('canvas')
  })
})

describe('randomDeliveryId', () => {
  it('mints a distinct opaque identity each call', () => {
    expect(randomDeliveryId()).not.toBe(randomDeliveryId())
  })
})
