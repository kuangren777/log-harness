// Acceptance 06-T2 at the pure level: an edit that moves a platform-owned field
// is refused and an edit that moves a field the agent owns is not. The two must
// be decided from the SAME reconstruction, so both directions are asserted
// against one on-disk revision.
import { describe, expect, it } from 'vitest'
import {
  RULE_MANIFEST_INVALID,
  RULE_MANIFEST_OWNED_FIELD,
  RULE_MANIFEST_UNVERIFIABLE,
  applyReplacement,
  checkManifestChange,
  parseManifestJson,
} from '@deepseek-ai/dsh-sci-workspace'

const PAPER = {
  version: 1,
  title: 'Attention Revisited',
  entry: 'src/main.tex',
  versions: [{ id: 'v1', createdAt: '2026-01-01T00:00:00Z' }],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
}
const PAPER_TEXT = JSON.stringify(PAPER, undefined, 2)
const PAPER_PATH = '/sci/projects/p1/papers/nn/nn.paper'

const SCIPLOT = {
  version: 1,
  title: 'Loss curve',
  language: 'python',
  style: 'line',
  entry: 'code/plot.py',
  history: [{ id: 'v1' }],
  annotations: [{ id: 'a1', text: 'note from the user' }],
}
const SCIPLOT_TEXT = JSON.stringify(SCIPLOT, undefined, 2)

describe('checkManifestChange over a paper manifest', () => {
  it('refuses an edit that appends to versions and names the field (06-T2)', () => {
    const after = JSON.stringify({ ...PAPER, versions: [...PAPER.versions, { id: 'v2' }] }, undefined, 2)
    const denial = checkManifestChange({ kind: 'paper', path: PAPER_PATH, op: 'edit', before: PAPER_TEXT, after })
    expect(denial?.rule).toBe(RULE_MANIFEST_OWNED_FIELD)
    expect(denial?.reason).toContain('versions')
    expect(denial?.reason).toContain('LaTeX workbench')
  })

  it('lets an edit of the title through (06-T2)', () => {
    const after = JSON.stringify({ ...PAPER, title: 'Attention Revisited, Again' }, undefined, 2)
    expect(checkManifestChange({ kind: 'paper', path: PAPER_PATH, op: 'edit', before: PAPER_TEXT, after })).toBeUndefined()
  })

  it('refuses an edit that replaces the manifest with something unparsable, because that drops versions', () => {
    const denial = checkManifestChange({ kind: 'paper', path: PAPER_PATH, op: 'edit', before: PAPER_TEXT, after: 'not json' })
    expect(denial?.rule).toBe(RULE_MANIFEST_OWNED_FIELD)
  })

  it('refuses a write whose result is not a valid manifest', () => {
    const denial = checkManifestChange({
      kind: 'paper',
      path: PAPER_PATH,
      op: 'write',
      before: undefined,
      after: JSON.stringify({ version: 1, entry: 'src/main.tex', versions: [] }),
    })
    expect(denial?.rule).toBe(RULE_MANIFEST_INVALID)
    expect(denial?.reason).toContain('title')
  })

  it('lets a write that creates a valid manifest through', () => {
    expect(checkManifestChange({
      kind: 'paper',
      path: PAPER_PATH,
      op: 'write',
      before: undefined,
      after: JSON.stringify({ ...PAPER, versions: [] }),
    })).toBeUndefined()
  })

  it('checks validity only on a write, so an edit can repair a manifest the workbench left defective', () => {
    const defective = JSON.stringify({ ...PAPER, title: 42 })
    const repaired = JSON.stringify({ ...PAPER, title: 'A title' })
    expect(checkManifestChange({ kind: 'paper', path: PAPER_PATH, op: 'edit', before: defective, after: repaired }))
      .toBeUndefined()
  })

  it('refuses a change it cannot reconstruct rather than guessing', () => {
    const denial = checkManifestChange({ kind: 'paper', path: PAPER_PATH, op: 'edit', before: PAPER_TEXT, after: undefined })
    expect(denial?.rule).toBe(RULE_MANIFEST_UNVERIFIABLE)
    expect(denial?.reason).toContain('write tool')
  })
})

describe('checkManifestChange over the other two kinds', () => {
  it('names the render script and the user for a sciplot', () => {
    const after = JSON.stringify({ ...SCIPLOT, annotations: [] }, undefined, 2)
    const denial = checkManifestChange({
      kind: 'sciplot',
      path: '/sci/projects/p1/sciplots/fig/fig.sciplot',
      op: 'edit',
      before: SCIPLOT_TEXT,
      after,
    })
    expect(denial?.rule).toBe(RULE_MANIFEST_OWNED_FIELD)
    expect(denial?.reason).toContain('annotations')
    expect(denial?.reason).toContain('render script')
  })

  it('checks a canvas for node geometry only, leaving asset validity to delivery', () => {
    const before = JSON.stringify({ nodes: [{ id: 'n1', position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }] })
    const moved = JSON.stringify({ nodes: [{ id: 'n1', position: { x: 5, y: 0 }, size: { w: 10, h: 10 } }] })
    const relabelled = JSON.stringify({ nodes: [{ id: 'n1', position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, label: 'x' }] })
    const path = '/sci/projects/p1/workspace/board.canvas'
    expect(checkManifestChange({ kind: 'canvas', path, op: 'edit', before, after: moved })?.reason)
      .toContain('nodes[n1].position')
    expect(checkManifestChange({ kind: 'canvas', path, op: 'write', before, after: relabelled })).toBeUndefined()
  })
})

describe('applyReplacement', () => {
  it('replaces the first occurrence, or every occurrence when asked', () => {
    expect(applyReplacement('a b a', 'a', 'X', false)).toBe('X b a')
    expect(applyReplacement('a b a', 'a', 'X', true)).toBe('X b X')
  })

  it('leaves content untouched when the literal is absent, so the tool reports that itself', () => {
    expect(applyReplacement('a b', 'z', 'X', false)).toBe('a b')
  })
})

describe('parseManifestJson', () => {
  it('reads valid JSON and treats an absent or unparsable revision as absent', () => {
    expect(parseManifestJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseManifestJson(undefined)).toBeUndefined()
    expect(parseManifestJson('{"a":1,}')).toBeUndefined()
  })
})
