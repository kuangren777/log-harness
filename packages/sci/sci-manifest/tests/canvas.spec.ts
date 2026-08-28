import { describe, expect, it } from 'vitest'
import { validateCanvas } from '@deepseek-ai/dsh-sci-manifest'
import type { CanvasAssetResolver } from '@deepseek-ai/dsh-sci-manifest'

/** Reports `hero.png` and `demo.mp4` as the only assets beside the manifest. */
const workspace: CanvasAssetResolver = {
  assetExists: relativePath => ['hero.png', 'demo.mp4'].includes(relativePath),
}

/**
 * A one-text-node board with per-case overrides.
 * @param overrides - fields replacing the defaults.
 * @returns a canvas manifest candidate.
 */
function canvas(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    nodes: [{ id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: { markdown: 'one' } }],
    edges: [],
    ...overrides,
  }
}

/**
 * Validate a candidate against {@link workspace} and return its errors.
 * @param candidate - value passed to `validateCanvas`.
 * @returns the reported errors, or `[]` when the board is valid.
 */
function errorsOf(candidate: unknown): readonly string[] {
  const result = validateCanvas(candidate, workspace)
  return result.ok ? [] : result.errors
}

/**
 * Validate a board holding exactly one node.
 * @param node - the single node under test.
 * @returns the reported errors.
 */
function nodeErrors(node: unknown): readonly string[] {
  return errorsOf(canvas({ nodes: [node] }))
}

/**
 * Validate a board holding one text node `n1` and exactly one edge.
 * @param edge - the single edge under test.
 * @returns the reported errors.
 */
function edgeErrors(edge: unknown): readonly string[] {
  return errorsOf(canvas({ edges: [edge] }))
}

describe('validateCanvas', () => {
  it('accepts the board from the skill', () => {
    const board = {
      version: 1,
      nodes: [
        { id: 'n1', type: 'image', position: { x: 80, y: 120 }, size: { width: 360, height: 240 }, data: { src: 'hero.png', title: 'Cover' } },
        { id: 'n2', type: 'video', position: { x: 520, y: 120 }, size: { width: 420, height: 260 }, data: { src: 'demo.mp4', title: 'Demo' } },
        { id: 'n3', type: 'text', position: { x: 80, y: 420 }, size: { width: 420, height: 200 }, data: { markdown: '## Title', title: 'Key points' } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n3', label: 'optional' }],
    }
    expect(validateCanvas(board, workspace)).toEqual({ ok: true, kind: 'canvas' })
  })

  it('reports the root itself when the value is not a JSON object', () => {
    expect(errorsOf(null)).toEqual(['canvas manifest must be a JSON object'])
  })

  it('pins the version discriminator at 1', () => {
    expect(errorsOf(canvas({ version: '1' }))).toEqual(['canvas manifest.version must be 1'])
  })

  it('requires both collections, even when empty', () => {
    expect(errorsOf({ version: 1 })).toEqual([
      'canvas manifest.nodes must be an array',
      'canvas manifest.edges must be an array',
    ])
    expect(validateCanvas({ version: 1, nodes: [], edges: [] }, workspace).ok).toBe(true)
  })

  it('names the index of a node that is not an object', () => {
    expect(nodeErrors('n1')).toEqual(['canvas manifest.nodes[0] must be a JSON object'])
  })

  it('requires a node id and reports the duplicate by value', () => {
    expect(nodeErrors({ type: 'text', position: { x: 0, y: 0 }, data: { markdown: 'one' } }))
      .toEqual(['canvas manifest.nodes[0].id must be a non-empty string'])
    const twins = [
      { id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: { markdown: 'one' } },
      { id: 'n1', type: 'text', position: { x: 300, y: 0 }, data: { markdown: 'two' } },
    ]
    expect(errorsOf(canvas({ nodes: twins })))
      .toEqual(['canvas manifest.nodes[1].id duplicates an earlier node id "n1"'])
  })

  it('requires world coordinates on every node', () => {
    expect(nodeErrors({ id: 'n1', type: 'text', data: { markdown: 'one' } }))
      .toEqual(['canvas manifest.nodes[0].position must be a JSON object'])
    expect(nodeErrors({ id: 'n1', type: 'text', position: { x: Number.NaN }, data: { markdown: 'one' } }))
      .toEqual([
        'canvas manifest.nodes[0].position.x must be a finite number',
        'canvas manifest.nodes[0].position.y must be a finite number',
      ])
    expect(validateCanvas(canvas({ nodes: [{ id: 'n1', type: 'text', position: { x: -40, y: -40 }, data: { markdown: 'one' } }] }), workspace).ok).toBe(true)
  })

  it('treats size as optional but validates it when present', () => {
    expect(nodeErrors({ id: 'n1', type: 'text', position: { x: 0, y: 0 }, size: 200, data: { markdown: 'one' } }))
      .toEqual(['canvas manifest.nodes[0].size must be a JSON object'])
    expect(nodeErrors({ id: 'n1', type: 'text', position: { x: 0, y: 0 }, size: { width: 0, height: '200' }, data: { markdown: 'one' } }))
      .toEqual([
        'canvas manifest.nodes[0].size.width must be a number greater than 0',
        'canvas manifest.nodes[0].size.height must be a number greater than 0',
      ])
    expect(nodeErrors({ id: 'n1', type: 'text', position: { x: 0, y: 0 }, size: { width: Number.POSITIVE_INFINITY, height: 200 }, data: { markdown: 'one' } }))
      .toEqual(['canvas manifest.nodes[0].size.width must be a number greater than 0'])
  })

  it('closes the node type set', () => {
    expect(nodeErrors({ id: 'n1', type: 'chart', position: { x: 0, y: 0 }, data: {} }))
      .toEqual(['canvas manifest.nodes[0].type must be one of image, video, text (got "chart")'])
    expect(nodeErrors({ id: 'n1', position: { x: 0, y: 0 }, data: {} }))
      .toEqual(['canvas manifest.nodes[0].type must be one of image, video, text (got undefined)'])
  })

  it('requires the data members each node type renders', () => {
    expect(nodeErrors({ id: 'n1', type: 'text', position: { x: 0, y: 0 } }))
      .toEqual(['canvas manifest.nodes[0].data must be a JSON object'])
    expect(nodeErrors({ id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: {} }))
      .toEqual(['canvas manifest.nodes[0].data.markdown must be a non-empty string'])
    expect(nodeErrors({ id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: {} }))
      .toEqual(['canvas manifest.nodes[0].data.src must be a non-empty string'])
  })

  it('accepts an optional card title and rejects a blank one', () => {
    expect(validateCanvas(canvas({ nodes: [{ id: 'n1', type: 'video', position: { x: 0, y: 0 }, data: { src: 'demo.mp4', title: 'Demo' } }] }), workspace).ok).toBe(true)
    expect(nodeErrors({ id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: { markdown: 'one', title: '' } }))
      .toEqual(['canvas manifest.nodes[0].data.title must be a non-empty string when present'])
  })

  it('keeps asset references relative to the manifest directory', () => {
    expect(nodeErrors({ id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { src: '/workspace/hero.png' } })[0])
      .toContain('not an absolute path')
    expect(nodeErrors({ id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { src: 'https://example.org/hero.png' } })[0])
      .toContain('not a URL or drive-qualified path')
    expect(nodeErrors({ id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { src: '../other/hero.png' } })[0])
      .toContain('escapes it with ".."')
  })

  it('requires every referenced asset to exist', () => {
    expect(nodeErrors({ id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { src: 'ghost.png' } }))
      .toEqual(['canvas manifest.nodes[0].data.src references a missing asset "ghost.png"'])
  })

  it('names the index of an edge that is not an object', () => {
    expect(edgeErrors(['n1', 'n1'])).toEqual(['canvas manifest.edges[0] must be a JSON object'])
  })

  it('requires an edge id and reports the duplicate by value', () => {
    const twins = [
      { id: 'e1', source: 'n1', target: 'n1' },
      { id: 'e1', source: 'n1', target: 'n1' },
    ]
    expect(errorsOf(canvas({ edges: twins })))
      .toEqual(['canvas manifest.edges[1].id duplicates an earlier edge id "e1"'])
    expect(edgeErrors({ source: 'n1', target: 'n1' }))
      .toEqual(['canvas manifest.edges[0].id must be a non-empty string'])
  })

  it('validates the optional edge label', () => {
    expect(edgeErrors({ id: 'e1', source: 'n1', target: 'n1', label: 3 }))
      .toEqual(['canvas manifest.edges[0].label must be a non-empty string when present'])
  })

  it('rejects an edge endpoint that is not a node id in this canvas', () => {
    expect(edgeErrors({ id: 'e1', source: 'n1', target: 'n9' }))
      .toEqual(['canvas manifest.edges[0] "e1" has target "n9", which is not a node id in this canvas'])
    expect(edgeErrors({ id: 'e1', source: 'n9', target: 'n1' }))
      .toEqual(['canvas manifest.edges[0] "e1" has source "n9", which is not a node id in this canvas'])
    expect(edgeErrors({ source: 'n9', target: 'n1' })).toEqual([
      'canvas manifest.edges[0].id must be a non-empty string',
      'canvas manifest.edges[0] has source "n9", which is not a node id in this canvas',
    ])
    expect(edgeErrors({ id: 'e1', target: 'n1' }))
      .toEqual(['canvas manifest.edges[0].source must be a non-empty string'])
  })

  it('reports dangling edges when the node list itself is unusable', () => {
    expect(errorsOf({ version: 1, nodes: {}, edges: [{ id: 'e1', source: 'n1', target: 'n1' }] })).toEqual([
      'canvas manifest.nodes must be an array',
      'canvas manifest.edges[0] "e1" has source "n1", which is not a node id in this canvas',
      'canvas manifest.edges[0] "e1" has target "n1", which is not a node id in this canvas',
    ])
  })
})
