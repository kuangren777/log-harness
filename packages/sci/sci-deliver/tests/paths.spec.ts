// The delivery-area rule is the one place the studied platform's three prose
// exceptions become executable, so it is pinned as a table: every row is a path
// a model plausibly writes, and its expected classification.
import { describe, expect, it } from 'vitest'
import { baseName, directoryName, isDeliverablePath, normalizeSegments } from '@deepseek-ai/dsh-sci-deliver'
import { PATHS, PROJECT, PROJECT_ROOT } from './harness.ts'

describe('normalizeSegments', () => {
  it.each([
    { path: '/a/b/c', expected: ['a', 'b', 'c'] },
    { path: 'a//b/./c', expected: ['a', 'b', 'c'] },
    { path: '/a/b/../c', expected: ['a', 'c'] },
    { path: '/../a', expected: ['a'] },
    { path: 'C:\\sci\\projects', expected: ['C:', 'sci', 'projects'] },
    { path: '', expected: [] },
  ])('resolves $path', ({ path, expected }) => {
    expect(normalizeSegments(path)).toEqual(expected)
  })
})

describe('baseName and directoryName', () => {
  it.each([
    { path: '/a/b/c.md', base: 'c.md', dir: '/a/b' },
    { path: 'c.md', base: 'c.md', dir: '' },
    { path: 'a\\b.md', base: 'b.md', dir: 'a' },
  ])('splits $path', ({ path, base, dir }) => {
    expect(baseName(path)).toBe(base)
    expect(directoryName(path)).toBe(dir)
  })
})

describe('isDeliverablePath', () => {
  it.each([
    { label: 'a file in the delivery directory', path: `${PROJECT}/workspace/report.md`, kind: 'file' },
    { label: 'a nested file in the delivery directory', path: `${PROJECT}/workspace/figures/fig1.png`, kind: 'file' },
    { label: 'a canvas board, which is authored there', path: `${PROJECT}/workspace/board.canvas`, kind: 'canvas' },
    { label: "a paper bundle's own manifest", path: `${PROJECT}/papers/intro/intro.paper`, kind: 'paper' },
    { label: "a figure bundle's own manifest", path: `${PROJECT}/sciplots/fig1/fig1.sciplot`, kind: 'sciplot' },
  ])('accepts $label', ({ path, kind }) => {
    expect(isDeliverablePath(path, PATHS)).toBe(kind)
  })

  it.each([
    { label: 'a scratch file', path: `${PROJECT}/tmp/draft.pdf` },
    { label: 'a build product inside a bundle', path: `${PROJECT}/papers/intro/versions/v1/intro.pdf` },
    { label: 'a manifest that is not in its own bundle directory', path: `${PROJECT}/papers/intro.paper` },
    { label: 'a manifest nested deeper than its bundle directory', path: `${PROJECT}/papers/intro/old/intro.paper` },
    { label: 'a paper manifest in the figure tree', path: `${PROJECT}/sciplots/fig1/fig1.paper` },
    { label: 'a figure manifest in the paper tree', path: `${PROJECT}/papers/intro/intro.sciplot` },
    { label: 'a canvas board inside a bundle', path: `${PROJECT}/papers/intro/intro.canvas` },
    { label: 'the delivery directory itself', path: `${PROJECT}/workspace` },
    { label: 'a project directory', path: PROJECT },
    { label: 'the project root itself', path: PROJECT_ROOT },
    { label: 'a path outside the project root', path: '/home/user/sci/skills/sci-plot/SKILL.md' },
    { label: 'a relative path the model guessed', path: 'tmp/a.pdf' },
    { label: 'a traversal back out of the delivery directory', path: `${PROJECT}/workspace/../tmp/a.md` },
  ])('refuses $label', ({ path }) => {
    expect(isDeliverablePath(path, PATHS)).toBeUndefined()
  })

  it('follows a renamed delivery directory', () => {
    const renamed = { ...PATHS, deliveryDir: 'deliverables' }
    expect(isDeliverablePath(`${PROJECT}/deliverables/report.md`, renamed)).toBe('file')
    expect(isDeliverablePath(`${PROJECT}/workspace/report.md`, renamed)).toBeUndefined()
  })
})
