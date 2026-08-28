// The validation chain decides both delivery channels, so it is tested against
// injected predicates rather than a filesystem: what matters is the ORDER of
// the four steps and the exact sentence each refusal gives the model.
import { describe, expect, it } from 'vitest'
import { validateDelivery } from '@deepseek-ai/dsh-sci-deliver'
import type { DeliveryIo, ManifestRead } from '@deepseek-ai/dsh-sci-deliver'
import {
  CANVAS_MANIFEST,
  DANGLING_CANVAS_MANIFEST,
  PATHS,
  PAPER_MANIFEST,
  PROJECT,
  SCIPLOT_MANIFEST,
} from './harness.ts'

interface IoOverrides {
  readonly files?: Readonly<Record<string, string>>
  readonly directories?: readonly string[]
  readonly assets?: readonly string[]
  readonly delivered?: readonly string[]
}

/**
 * Build the injected predicates one case needs. Anything named in `files` or
 * `directories` exists; only `files` members are regular files.
 */
function io(overrides: IoOverrides = {}): DeliveryIo {
  const files = overrides.files ?? {}
  const directories = overrides.directories ?? []
  const assets = new Set(overrides.assets ?? [])
  const delivered = new Set(overrides.delivered ?? [])
  return {
    paths: PATHS,
    exists: path => Promise.resolve(path in files || directories.includes(path)),
    isFile: path => Promise.resolve(path in files),
    readManifest: (path): Promise<ManifestRead> => Promise.resolve({
      text: files[path] ?? '',
      assetExists: relativePath => assets.has(relativePath),
    }),
    alreadyDelivered: path => delivered.has(path),
  }
}

const REPORT = `${PROJECT}/workspace/report.md`
const PAPER = `${PROJECT}/papers/intro/intro.paper`
const SCIPLOT = `${PROJECT}/sciplots/fig1/fig1.sciplot`
const CANVAS = `${PROJECT}/workspace/board.canvas`

/** One request with only the path varying; title and description never affect the decision. */
function request(path: string): { path: string; title: string } {
  return { path, title: 'Result' }
}

describe('validateDelivery step 1: the delivery area', () => {
  it('refuses a scratch file and names the delivery directory (06-T3)', async () => {
    const decision = await validateDelivery(request(`${PROJECT}/tmp/a.pdf`), io())
    expect(decision.ok).toBe(false)
    expect(decision.ok ? '' : decision.reason).toContain('workspace/')
    if (!decision.ok) expect(decision.reason).toContain('copy it into workspace/')
  })

  it('decides the area before touching the filesystem', async () => {
    // The file does not exist either; the reason must still be the actionable one.
    const decision = await validateDelivery(request(`${PROJECT}/tmp/a.pdf`), io())
    if (decision.ok) throw new Error('expected a refusal')
    expect(decision.reason).not.toContain('does not exist')
  })
})

describe('validateDelivery step 2: the file itself', () => {
  it('refuses an absent path', async () => {
    const decision = await validateDelivery(request(REPORT), io())
    expect(decision).toEqual({ ok: false, reason: `${REPORT} does not exist` })
  })

  it('refuses a directory', async () => {
    const directory = `${PROJECT}/workspace/figures`
    const decision = await validateDelivery(request(directory), io({ directories: [directory] }))
    expect(decision).toEqual({ ok: false, reason: `${directory} is not a regular file` })
  })

  it('accepts an ordinary file without reading it', async () => {
    const decision = await validateDelivery(request(REPORT), io({ files: { [REPORT]: '# Report' } }))
    expect(decision).toEqual({ ok: true, kind: 'file' })
  })
})

describe('validateDelivery step 3: manifests', () => {
  it.each([
    { label: 'paper', path: PAPER, text: PAPER_MANIFEST, kind: 'paper' },
    { label: 'sciplot', path: SCIPLOT, text: SCIPLOT_MANIFEST, kind: 'sciplot' },
  ])('accepts a valid $label manifest', async ({ path, text, kind }) => {
    expect(await validateDelivery(request(path), io({ files: { [path]: text } }))).toEqual({ ok: true, kind })
  })

  it('accepts a canvas board whose assets are beside it', async () => {
    const decision = await validateDelivery(
      request(CANVAS),
      io({ files: { [CANVAS]: CANVAS_MANIFEST }, assets: ['assets/hero.png'] }),
    )
    expect(decision).toEqual({ ok: true, kind: 'canvas' })
  })

  it('refuses a canvas board whose asset is missing', async () => {
    const decision = await validateDelivery(request(CANVAS), io({ files: { [CANVAS]: CANVAS_MANIFEST } }))
    if (decision.ok) throw new Error('expected a refusal')
    expect(decision.reason).toContain('is not a valid canvas manifest')
    expect(decision.reason).toContain('assets/hero.png')
  })

  it('refuses a canvas edge that points at a missing node, naming the edge', async () => {
    const decision = await validateDelivery(request(CANVAS), io({ files: { [CANVAS]: DANGLING_CANVAS_MANIFEST } }))
    if (decision.ok) throw new Error('expected a refusal')
    expect(decision.reason).toContain('e1')
  })

  it('refuses a manifest that is not JSON', async () => {
    const decision = await validateDelivery(request(PAPER), io({ files: { [PAPER]: '{ oops' } }))
    if (decision.ok) throw new Error('expected a refusal')
    expect(decision.reason).toContain(`${PAPER} is not valid JSON:`)
  })

  it('refuses a manifest the validator rejects, quoting the offending field', async () => {
    const text = JSON.stringify({ ...JSON.parse(PAPER_MANIFEST), title: '' })
    const decision = await validateDelivery(request(PAPER), io({ files: { [PAPER]: text } }))
    expect(decision).toEqual({
      ok: false,
      reason: `${PAPER} is not a valid paper manifest: paper manifest.title must be a non-empty string`,
    })
  })

  it('refuses a second delivery of the same manifest (06-T4)', async () => {
    const predicates = io({ files: { [SCIPLOT]: SCIPLOT_MANIFEST } })
    expect(await validateDelivery(request(SCIPLOT), predicates)).toEqual({ ok: true, kind: 'sciplot' })

    const afterDelivery = io({ files: { [SCIPLOT]: SCIPLOT_MANIFEST }, delivered: [SCIPLOT] })
    const decision = await validateDelivery(request(SCIPLOT), afterDelivery)
    if (decision.ok) throw new Error('expected a refusal')
    expect(decision.reason).toBe(
      `${SCIPLOT} was already delivered; later edits reach the open workbench live — describe the change in chat instead`,
    )
  })

  it('does not budget ordinary files, which may be delivered again', async () => {
    const predicates = io({ files: { [REPORT]: '# Report' }, delivered: [REPORT] })
    expect(await validateDelivery(request(REPORT), predicates)).toEqual({ ok: true, kind: 'file' })
  })
})
