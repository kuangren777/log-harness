// The path taxonomy is the input of every rule in this package, so it is pinned
// as a table: one row per class of the workspace contract, plus the boundaries
// where a path stops belonging to a class (a bundle group with no slug, a PDF
// that IS a build product, a manifest extension in the wrong bundle).
import { describe, expect, it } from 'vitest'
import {
  PATH_CLASSES,
  classifyPath,
  isAbsolutePath,
  normalizePath,
  pathSegments,
  resolveAgainst,
  segmentsUnder,
} from '@deepseek-ai/dsh-sci-workspace'
import type { PathClass, PathLayout } from '@deepseek-ai/dsh-sci-workspace'

const LAYOUT: PathLayout = {
  projectRoot: '/sci/projects',
  deliveryDir: 'workspace',
  scratchDir: 'tmp',
  bundleDirs: { papers: 'papers', sciplots: 'sciplots' },
  skillsDir: 'skills',
  privateDir: '.sci',
  spoolPendingDir: '.sci/spool/pending',
}

const CLASSIFICATIONS: readonly (readonly [string, PathClass])[] = [
  ['/sci/projects/p1/workspace/report.md', 'workspace'],
  ['/sci/projects/p1/tmp/refs/other.pdf', 'tmp'],
  ['/sci/projects/p1/papers/nn/src/main.tex', 'paper-src'],
  ['/sci/projects/p1/papers/nn/nn.paper', 'paper-manifest'],
  ['/sci/projects/p1/papers/nn/versions/v1/main.tex', 'paper-versions'],
  ['/sci/projects/p1/sciplots/fig/code/plot.py', 'sciplot-code'],
  ['/sci/projects/p1/sciplots/fig/fig.sciplot', 'sciplot-manifest'],
  ['/sci/projects/p1/sciplots/fig/versions/v2/out.png', 'sciplot-versions'],
  ['/sci/projects/p1/papers/nn/downloaded/attention.pdf', 'references'],
  ['/sci/skills/sci-plot/SKILL.md', 'skills'],
  ['/sci/.sci/spool/pending/2f0c.json', 'spool-pending'],
  ['/sci/.sci/skills.json', 'private'],
  ['/sci/memory/gaussian-process.md', 'other'],
]

describe('classifyPath over the workspace contract table', () => {
  it.each(CLASSIFICATIONS)('classifies %s as %s', (path, expected) => {
    expect(classifyPath(path, LAYOUT)).toBe(expected)
  })

  it('reaches every published class', () => {
    expect(new Set(CLASSIFICATIONS.map(([, cls]) => cls))).toEqual(new Set(PATH_CLASSES))
  })

  it('keeps a build product under src/ in the shared editing area rather than calling it a reference', () => {
    expect(classifyPath('/sci/projects/p1/papers/nn/src/figure.pdf', LAYOUT)).toBe('paper-src')
    expect(classifyPath('/sci/projects/p1/papers/nn/versions/v1/nn.pdf', LAYOUT)).toBe('paper-versions')
  })

  it('does not treat a manifest extension in the other bundle as that bundle\'s manifest', () => {
    expect(classifyPath('/sci/projects/p1/papers/nn/nn.sciplot', LAYOUT)).toBe('other')
    expect(classifyPath('/sci/projects/p1/sciplots/fig/fig.paper', LAYOUT)).toBe('other')
  })

  it('leaves locations with no rule of their own unmanaged', () => {
    expect(classifyPath('/sci/projects', LAYOUT)).toBe('other')
    expect(classifyPath('/sci/projects/p1', LAYOUT)).toBe('other')
    expect(classifyPath('/sci/projects/p1/papers', LAYOUT)).toBe('other')
    expect(classifyPath('/sci/projects/p1/papers/nn', LAYOUT)).toBe('other')
    expect(classifyPath('/sci/projects/p1/papers/nn/notes.md', LAYOUT)).toBe('other')
    expect(classifyPath('/sci/projects/p1/sciplots/fig/notes.md', LAYOUT)).toBe('other')
    expect(classifyPath('/sci/projects/p1/notes.md', LAYOUT)).toBe('other')
    expect(classifyPath('/sci/projects/p1/notebooks/exploration/run.ipynb', LAYOUT)).toBe('other')
    expect(classifyPath('/etc/passwd', LAYOUT)).toBe('other')
  })

  it('classifies a path reached through parent traversal by where it lands', () => {
    expect(classifyPath('/sci/projects/p1/papers/../workspace/report.md', LAYOUT)).toBe('workspace')
    expect(classifyPath('/sci/skills/../.sci/state.json', LAYOUT)).toBe('private')
  })

  it('classifies a backslash-separated backend path the same way', () => {
    expect(classifyPath('C:\\sci\\projects\\p1\\tmp\\scratch.aux', { ...LAYOUT, projectRoot: 'C:/sci/projects' }))
      .toBe('tmp')
  })

  it('leaves a relative path unmanaged, because only a resolved path can be placed', () => {
    expect(classifyPath('workspace/report.md', LAYOUT)).toBe('other')
  })
})

describe('path helpers', () => {
  it('folds . and .. and keeps a traversal that escapes the root it was given', () => {
    expect(pathSegments('a/./b/../c')).toEqual(['a', 'c'])
    expect(pathSegments('a/../../b')).toEqual(['..', 'b'])
    expect(pathSegments('')).toEqual([])
  })

  it('recognizes POSIX roots and Windows drives as absolute', () => {
    expect(isAbsolutePath('/sci')).toBe(true)
    expect(isAbsolutePath('C:\\sci')).toBe(true)
    expect(isAbsolutePath('sci/projects')).toBe(false)
  })

  it('normalizes while preserving whether the path started at a root', () => {
    expect(normalizePath('/sci//projects/./p1')).toBe('/sci/projects/p1')
    expect(normalizePath('sci/projects/../p1')).toBe('sci/p1')
  })

  it('resolves an operand against a working directory, honoring an absolute operand', () => {
    expect(resolveAgainst('/sci/projects/p1/papers', '../sciplots')).toBe('/sci/projects/p1/sciplots')
    expect(resolveAgainst('/sci/projects/p1', '/etc/hosts')).toBe('/etc/hosts')
  })

  it('reports containment, the root itself, and a sibling that merely shares a prefix', () => {
    expect(segmentsUnder(['sci', 'projects'], ['sci', 'projects', 'p1'])).toEqual(['p1'])
    expect(segmentsUnder(['sci', 'projects'], ['sci', 'projects'])).toEqual([])
    expect(segmentsUnder(['sci', 'projects'], ['sci', 'projectsX', 'p1'])).toBeUndefined()
    expect(segmentsUnder(['sci', 'projects'], ['sci'])).toBeUndefined()
  })
})
