import { describe, expect, it } from 'vitest'
import { BUNDLE_KINDS, isManifestPath } from '@deepseek-ai/dsh-sci-manifest'

describe('BUNDLE_KINDS', () => {
  it('lists the three bundle kinds in the order the sci packages report them', () => {
    expect(BUNDLE_KINDS).toEqual(['paper', 'sciplot', 'canvas'])
  })
})

describe('isManifestPath', () => {
  it('classifies a manifest by its extension', () => {
    expect(isManifestPath('papers/dose-response-modeling/dose-response-modeling.paper')).toBe('paper')
    expect(isManifestPath('sciplots/effect-by-group/effect-by-group.sciplot')).toBe('sciplot')
    expect(isManifestPath('workspace/travel-moodboard.canvas')).toBe('canvas')
    expect(isManifestPath('board.canvas')).toBe('canvas')
  })

  it('accepts either directory separator', () => {
    expect(isManifestPath('C:\\Users\\u\\sci\\workspace\\board.canvas')).toBe('canvas')
    expect(isManifestPath('/home/user/sci/projects/p/papers/x/x.paper')).toBe('paper')
  })

  it('returns undefined for anything that is not a bundle manifest', () => {
    expect(isManifestPath('papers/x/src/main.tex')).toBe(undefined)
    expect(isManifestPath('papers/x')).toBe(undefined)
    expect(isManifestPath('')).toBe(undefined)
  })

  it('requires a file name in front of the extension', () => {
    expect(isManifestPath('.paper')).toBe(undefined)
    expect(isManifestPath('papers/x/.sciplot')).toBe(undefined)
  })

  it('matches the extension exactly, not as a substring', () => {
    expect(isManifestPath('workspace/board.canvas.bak')).toBe(undefined)
    expect(isManifestPath('workspace/board.paperclip')).toBe(undefined)
  })

  it('matches the extension case-insensitively', () => {
    expect(isManifestPath('Report.PAPER')).toBe('paper')
    expect(isManifestPath('A.Paper')).toBe('paper')
    expect(isManifestPath('fig.SCIPLOT')).toBe('sciplot')
    expect(isManifestPath('board.Canvas')).toBe('canvas')
  })
})
