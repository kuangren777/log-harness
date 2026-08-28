import { describe, expect, it } from 'vitest'
import { diffOwnedFields } from '@deepseek-ai/dsh-sci-manifest'

/** A manifest member of any JSON shape, so a case may replace one field's type. */
type Loose = Record<string, unknown>

const PAPER: Loose = {
  version: 1,
  title: 'Attention-based dose-response modeling',
  entry: 'src/main.tex',
  versions: [{ id: 'v1', note: 'initial submission' }],
  createdAt: '2026-07-23T08:00:00Z',
  updatedAt: '2026-07-23T08:00:00Z',
}

const SCIPLOT: Loose = {
  version: 1,
  title: 'Treatment effect by group',
  language: 'en',
  style: 'nature',
  entry: 'code/plot.py',
  output: 'versions/v1/figure.png',
  history: [{ version: 1, note: 'first render' }],
  annotations: [{ id: 'a1', comment: 'legend overlaps', resolved: false }],
}

const CANVAS: { version: number; nodes: Loose[]; edges: unknown[] } = {
  version: 1,
  nodes: [
    { id: 'n1', type: 'image', position: { x: 80, y: 120 }, size: { width: 360, height: 240 }, data: { src: 'hero.png', title: 'Cover' } },
    { id: 'n2', type: 'text', position: { x: 80, y: 420 }, data: { markdown: 'one' } },
  ],
  edges: [],
}

/**
 * Structured-clone a fixture so a case can mutate it without leaking.
 * @param value - the fixture to copy.
 * @returns an independent deep copy.
 */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('diffOwnedFields for paper bundles', () => {
  it('reports nothing when the platform archive is untouched', () => {
    expect(diffOwnedFields('paper', PAPER, copy(PAPER))).toEqual([])
  })

  it('reports nothing for the fields the agent owns', () => {
    expect(diffOwnedFields('paper', PAPER, { ...PAPER, title: 'A new title', entry: 'src/thesis.tex' })).toEqual([])
  })

  it('reports an appended submission snapshot', () => {
    const after = { ...PAPER, versions: [{ id: 'v1', note: 'initial submission' }, { id: 'v2', note: 'major revision' }] }
    expect(diffOwnedFields('paper', PAPER, after)).toEqual(['versions'])
  })

  it('reports an edited submission snapshot', () => {
    const after = { ...PAPER, versions: [{ id: 'v1', note: 'rewritten by the agent' }] }
    expect(diffOwnedFields('paper', PAPER, after)).toEqual(['versions'])
  })

  it('reports a replaced archive whose type changed', () => {
    expect(diffOwnedFields('paper', PAPER, { ...PAPER, versions: {} })).toEqual(['versions'])
  })

  it('treats an unreadable side as a change to every owned field', () => {
    expect(diffOwnedFields('paper', 'not a manifest', PAPER)).toEqual(['versions'])
    expect(diffOwnedFields('paper', PAPER, undefined)).toEqual(['versions'])
  })
})

describe('diffOwnedFields for sciplot bundles', () => {
  it('reports nothing when the render script and user fields are untouched', () => {
    expect(diffOwnedFields('sciplot', SCIPLOT, copy(SCIPLOT))).toEqual([])
  })

  it('reports nothing for the metadata the agent may edit', () => {
    const after = { ...SCIPLOT, title: 'Effect by cohort', language: 'zh', style: 'ieee', entry: 'code/v2.py' }
    expect(diffOwnedFields('sciplot', SCIPLOT, after)).toEqual([])
  })

  it('reports each owned field in a stable order', () => {
    const after = {
      ...SCIPLOT,
      history: [],
      output: 'versions/v2/figure.png',
      annotations: [],
    }
    expect(diffOwnedFields('sciplot', SCIPLOT, after)).toEqual(['history', 'output', 'annotations'])
  })

  it('reports an annotation the agent resolved by hand', () => {
    const after = { ...SCIPLOT, annotations: [{ id: 'a1', comment: 'legend overlaps', resolved: true }] }
    expect(diffOwnedFields('sciplot', SCIPLOT, after)).toEqual(['annotations'])
  })

  it('reports an annotation that gained or renamed a member', () => {
    const grown = { ...SCIPLOT, annotations: [{ id: 'a1', comment: 'legend overlaps', resolved: false, rect: [0, 0, 1, 1] }] }
    expect(diffOwnedFields('sciplot', SCIPLOT, grown)).toEqual(['annotations'])
    const renamed = { ...SCIPLOT, annotations: [{ ref: 'a1', comment: 'legend overlaps', resolved: false }] }
    expect(diffOwnedFields('sciplot', SCIPLOT, renamed)).toEqual(['annotations'])
  })

  it('reports an output whose type changed, in either direction', () => {
    const multiFormat = { ...SCIPLOT, output: { png: 'figure.png', svg: 'figure.svg' } }
    expect(diffOwnedFields('sciplot', SCIPLOT, multiFormat)).toEqual(['output'])
    expect(diffOwnedFields('sciplot', multiFormat, SCIPLOT)).toEqual(['output'])
  })

  it('reports nothing when neither side carries an output yet', () => {
    const pending: Loose = { ...SCIPLOT }
    delete pending['output']
    expect(diffOwnedFields('sciplot', pending, copy(pending))).toEqual([])
  })
})

describe('diffOwnedFields for canvas boards', () => {
  it('reports nothing for a board the user has not re-laid-out', () => {
    expect(diffOwnedFields('canvas', CANVAS, copy(CANVAS))).toEqual([])
  })

  it('reports nothing for card content the agent owns', () => {
    const after = copy(CANVAS)
    after.nodes[1]!.data = { markdown: 'rewritten' }
    expect(diffOwnedFields('canvas', CANVAS, after)).toEqual([])
  })

  it('names the node whose position moved', () => {
    const after = copy(CANVAS)
    after.nodes[0]!.position = { x: 81, y: 120 }
    expect(diffOwnedFields('canvas', CANVAS, after)).toEqual(['nodes[n1].position'])
  })

  it('names the node whose size changed, including a size added where none existed', () => {
    const resized = copy(CANVAS)
    resized.nodes[0]!.size = { width: 360 }
    expect(diffOwnedFields('canvas', CANVAS, resized)).toEqual(['nodes[n1].size'])
    const grown = copy(CANVAS)
    grown.nodes[1]!.size = { width: 200, height: 200 }
    expect(diffOwnedFields('canvas', CANVAS, grown)).toEqual(['nodes[n2].size'])
  })

  it('reports both geometry fields of one node', () => {
    const after = copy(CANVAS)
    after.nodes[0]!.position = { x: 0, y: 0 }
    after.nodes[0]!.size = { width: 100, height: 100 }
    expect(diffOwnedFields('canvas', CANVAS, after)).toEqual(['nodes[n1].position', 'nodes[n1].size'])
  })

  it('ignores nodes the edit added or removed', () => {
    const removed = { ...CANVAS, nodes: [CANVAS.nodes[0]] }
    expect(diffOwnedFields('canvas', CANVAS, removed)).toEqual([])
    const added = { ...CANVAS, nodes: [...CANVAS.nodes, { id: 'n3', type: 'text', position: { x: 0, y: 900 }, data: { markdown: 'new' } }] }
    expect(diffOwnedFields('canvas', CANVAS, added)).toEqual([])
  })

  it('reports geometry of nodes with no usable id on the before side', () => {
    const before = { ...CANVAS, nodes: [{ type: 'text', position: { x: 0, y: 0 }, data: { markdown: 'one' } }] }
    const after = { ...CANVAS, nodes: [{ type: 'text', position: { x: 999, y: 0 }, data: { markdown: 'one' } }] }
    expect(diffOwnedFields('canvas', before, after)).toEqual(['nodes[0].position', 'nodes[0].size'])
    const numeric = { ...CANVAS, nodes: [{ id: 1, type: 'text', position: { x: 0, y: 0 }, data: { markdown: 'one' } }] }
    expect(diffOwnedFields('canvas', numeric, numeric)).toEqual(['nodes[0].position', 'nodes[0].size'])
  })

  it('reports a re-position hidden behind a duplicated id', () => {
    const first = CANVAS.nodes[0]
    const duplicated = { ...CANVAS, nodes: [first, { ...first, position: { x: 999, y: 999 } }] }
    expect(diffOwnedFields('canvas', CANVAS, duplicated)).toEqual(['nodes[n1].position', 'nodes[n1].size'])
    const beforeDuplicated = { ...CANVAS, nodes: [first, { ...first }] }
    expect(diffOwnedFields('canvas', beforeDuplicated, CANVAS)).toEqual(['nodes[n1].position', 'nodes[n1].size', 'nodes[n1].position', 'nodes[n1].size'])
  })

  it('treats an unreadable after-side node list as changing every before-node geometry', () => {
    const everyGeometry = CANVAS.nodes.flatMap(node => [`nodes[${String(node.id)}].position`, `nodes[${String(node.id)}].size`])
    expect(diffOwnedFields('canvas', CANVAS, 'not a manifest')).toEqual(everyGeometry)
    expect(diffOwnedFields('canvas', CANVAS, { version: 1, nodes: {} })).toEqual(everyGeometry)
    expect(diffOwnedFields('canvas', { version: 1, nodes: {} }, CANVAS)).toEqual([])
    const filtered = { version: 1, nodes: ['n1', CANVAS.nodes[1]] }
    expect(diffOwnedFields('canvas', CANVAS, filtered)).toEqual([])
  })
})
