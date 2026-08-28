// Acceptance 06-T8 and its neighbours: a recursive delete is refused by where
// its operands LAND, not by how they were written, so the relative form, the
// parent-traversal form, and the quoted form all have to reach the same answer.
import { describe, expect, it } from 'vitest'
import { RULE_BUNDLE_RECURSIVE_DELETE, recursiveDeleteOperands, screenShellCommand, tokenizeCommand } from '@deepseek-ai/dsh-sci-workspace'
import type { ShellScreenConfig } from '@deepseek-ai/dsh-sci-workspace'

const CONFIG: ShellScreenConfig = {
  cwd: '/sci/projects/p1',
  projectRoot: '/sci/projects',
  bundleDirs: { papers: 'papers', sciplots: 'sciplots' },
  denyRecursiveDeleteInBundles: true,
}

describe('screenShellCommand', () => {
  it('lets a recursive delete inside the scratch area through', () => {
    expect(screenShellCommand('rm -rf tmp/x', CONFIG)).toBeUndefined()
  })

  it('refuses rm -rf on a sciplot bundle (06-T8)', () => {
    const denial = screenShellCommand('rm -rf sciplots/x', CONFIG)
    expect(denial).toMatchObject({ path: '/sci/projects/p1/sciplots/x', rule: RULE_BUNDLE_RECURSIVE_DELETE })
    expect(denial?.reason).toContain('append-only')
  })

  it('refuses a bundle reached through parent traversal', () => {
    expect(screenShellCommand('rm -rf ../sciplots', { ...CONFIG, cwd: '/sci/projects/p1/papers' }))
      .toMatchObject({ path: '/sci/projects/p1/sciplots' })
  })

  it('refuses git clean reaching into the manuscript bundles', () => {
    expect(screenShellCommand('git clean -fdx papers/', CONFIG))
      .toMatchObject({ path: '/sci/projects/p1/papers' })
  })

  it('refuses a bare git clean run from inside a bundle, which defaults to the working directory', () => {
    expect(screenShellCommand('git clean -fd', { ...CONFIG, cwd: '/sci/projects/p1/papers/nn' }))
      .toMatchObject({ path: '/sci/projects/p1/papers/nn' })
  })

  it('refuses find -delete rooted at a bundle and lets one rooted at the scratch area through', () => {
    expect(screenShellCommand('find papers -name "*.aux" -delete', CONFIG))
      .toMatchObject({ path: '/sci/projects/p1/papers' })
    expect(screenShellCommand('find tmp -name "*.aux" -delete', CONFIG)).toBeUndefined()
    expect(screenShellCommand('find -delete', { ...CONFIG, cwd: '/sci/projects/p1/sciplots' }))
      .toMatchObject({ path: '/sci/projects/p1/sciplots' })
  })

  it('screens each command of a list and each operand of a command', () => {
    expect(screenShellCommand('ls tmp && rm -rf tmp/a papers/nn', CONFIG))
      .toMatchObject({ path: '/sci/projects/p1/papers/nn' })
  })

  it('resolves a quoted operand as one path', () => {
    expect(screenShellCommand('rm -rf "sciplots/my figure"', CONFIG))
      .toMatchObject({ path: '/sci/projects/p1/sciplots/my figure' })
  })

  it('takes an absolute operand as written, including one in another project', () => {
    expect(screenShellCommand('rm -rf /sci/projects/p2/papers', CONFIG))
      .toMatchObject({ path: '/sci/projects/p2/papers' })
    expect(screenShellCommand('rm -rf /tmp/build', CONFIG)).toBeUndefined()
  })

  it('leaves a non-recursive rm and an unrelated command alone', () => {
    expect(screenShellCommand('rm sciplots/fig/code/plot.py', CONFIG)).toBeUndefined()
    expect(screenShellCommand('ls -R sciplots', CONFIG)).toBeUndefined()
    expect(screenShellCommand('git status sciplots', CONFIG)).toBeUndefined()
    expect(screenShellCommand('find sciplots -name "*.png"', CONFIG)).toBeUndefined()
    expect(screenShellCommand('', CONFIG)).toBeUndefined()
  })

  it('screens an absolute rm path the same way', () => {
    expect(screenShellCommand('/bin/rm --recursive --force sciplots/x', CONFIG))
      .toMatchObject({ path: '/sci/projects/p1/sciplots/x' })
  })

  it('does nothing while the deployment has the screen switched off', () => {
    expect(screenShellCommand('rm -rf sciplots/x', { ...CONFIG, denyRecursiveDeleteInBundles: false })).toBeUndefined()
  })

  it('leaves a delete above the project layer alone; the sandbox owns that decision', () => {
    expect(screenShellCommand('rm -rf /sci/projects', CONFIG)).toBeUndefined()
    expect(screenShellCommand('rm -rf /sci/projects/p1', CONFIG)).toBeUndefined()
  })
})

describe('tokenizeCommand', () => {
  it('splits on operators and whitespace, keeping quoted and escaped text in one token', () => {
    expect(tokenizeCommand('ls a | grep "b c"; rm -rf d\\ e')).toEqual([
      ['ls', 'a'],
      ['grep', 'b c'],
      ['rm', '-rf', 'd e'],
    ])
  })

  it('keeps an explicitly empty argument and honors escapes inside double quotes', () => {
    expect(tokenizeCommand('echo \'\' "a\\"b" \'c d\'')).toEqual([['echo', '', 'a"b', 'c d']])
  })

  it('ends a command at a newline and drops empty commands', () => {
    expect(tokenizeCommand('  \n ls \n\n rm x \n ')).toEqual([['ls'], ['rm', 'x']])
  })

  it('keeps a trailing backslash as a literal character', () => {
    expect(tokenizeCommand('rm a\\')).toEqual([['rm', 'a\\']])
  })
})

describe('recursiveDeleteOperands', () => {
  it('reports nothing for an empty command', () => {
    expect(recursiveDeleteOperands([])).toBeUndefined()
  })

  it('keeps the stdin marker as an operand rather than reading it as an option', () => {
    expect(recursiveDeleteOperands(['rm', '-r', '-'])).toEqual(['-'])
  })
})
