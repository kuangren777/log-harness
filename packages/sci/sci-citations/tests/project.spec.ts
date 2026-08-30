// Which project a request is about. The refusals matter more than the
// successes: a slug guessed wrong files a citation into another manuscript's
// bibliography, and a slug carrying a separator reaches outside `projectRoot`.
import { describe, expect, it } from 'vitest'
import { CITATIONS_INVALID_REQUEST, CitationsError } from '../src/error.ts'
import { assertProjectSlug, pathSegments, projectSlugFromCwd } from '../src/project.ts'

const ROOT = '/home/user/sci/projects'

describe('pathSegments', () => {
  it.each([
    ['an absolute POSIX path', '/a/b/c', ['a', 'b', 'c']],
    ['a Windows-shaped path', 'C:\\a\\b', ['C:', 'a', 'b']],
    ['duplicated separators', '/a//b/', ['a', 'b']],
    ['a current-directory segment', '/a/./b', ['a', 'b']],
    ['a parent segment', '/a/b/../c', ['a', 'c']],
    ['a parent segment past the root', '../a', ['..', 'a']],
    ['two parent segments past the root', '../../a', ['..', '..', 'a']],
    ['nothing at all', '', []],
  ])('resolves %s', (_case, path, expected) => {
    expect(pathSegments(path)).toEqual(expected)
  })
})

describe('projectSlugFromCwd', () => {
  it.each([
    ['the project directory itself', `${ROOT}/snse`, 'snse'],
    ['a directory inside the project', `${ROOT}/snse/papers/p1/src`, 'snse'],
    ['a trailing separator', `${ROOT}/snse/`, 'snse'],
  ])('reads the slug from %s', (_case, cwd, expected) => {
    expect(projectSlugFromCwd(cwd, ROOT)).toBe(expected)
  })

  it.each([
    ['a session with no working directory', undefined],
    ['the project root itself', ROOT],
    ['a directory above the root', '/home/user'],
    ['a directory beside the root', '/home/user/sci/other/snse'],
  ])('refuses to guess for %s', (_case, cwd) => {
    expect(projectSlugFromCwd(cwd, ROOT)).toBeUndefined()
  })
})

describe('assertProjectSlug', () => {
  it('accepts a bare directory name and trims it', () => {
    expect(assertProjectSlug('  snse ')).toBe('snse')
  })

  it.each([
    ['an empty slug', ''],
    ['whitespace only', '   '],
    ['a slug with a separator', 'a/b'],
    ['a slug that escapes the root', '..'],
    ['a slug naming the root itself', '.'],
    ['an absolute path', '/snse'],
    ['a traversal spelled with separators', '../other'],
  ])('refuses %s', (_case, slug) => {
    expect(() => assertProjectSlug(slug)).toThrow(CitationsError)
    expect(() => assertProjectSlug(slug)).toThrow(expect.objectContaining({ code: CITATIONS_INVALID_REQUEST }))
  })
})
