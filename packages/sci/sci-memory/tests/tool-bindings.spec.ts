// Config validation of the observed tool list and the argument reading it
// drives: a sub-command declaration that only half exists would silently index
// every read or nothing at all, and a read command must never look like a write.
import { describe, expect, it } from 'vitest'
import { resolveMemoryTools, resolveTargetPath } from '@deepseek-ai/dsh-sci-memory'
import type { MemoryToolBinding } from '@deepseek-ai/dsh-sci-memory'

const WRITE: MemoryToolBinding = { name: 'write', pathArg: 'file_path', commandArg: '', writeCommands: [] }
const EDITOR: MemoryToolBinding = {
  name: 'str_replace_editor',
  pathArg: 'path',
  commandArg: 'command',
  writeCommands: ['create', 'str_replace', 'insert'],
}

describe('resolveMemoryTools', () => {
  it('indexes bindings by tool name', () => {
    const resolved = resolveMemoryTools([WRITE, EDITOR])
    expect([...resolved.keys()]).toEqual(['write', 'str_replace_editor'])
    expect(resolved.get('str_replace_editor')).toBe(EDITOR)
  })

  it('rejects a command argument declared without its write commands', () => {
    expect(() => resolveMemoryTools([{ ...EDITOR, writeCommands: [] }]))
      .toThrow(/tool "str_replace_editor" must declare commandArg and writeCommands together/)
  })

  it('rejects write commands declared without a command argument', () => {
    expect(() => resolveMemoryTools([{ ...WRITE, writeCommands: ['create'] }]))
      .toThrow(/tool "write" must declare commandArg and writeCommands together/)
  })
})

describe('resolveTargetPath', () => {
  it.each([
    ['a plain write call', WRITE, { file_path: '/sci/memory/a.md' }, '/sci/memory/a.md'],
    ['an editor create', EDITOR, { command: 'create', path: '/sci/memory/a.md' }, '/sci/memory/a.md'],
    ['an editor replacement', EDITOR, { command: 'str_replace', path: '/x.md' }, '/x.md'],
  ])('reads the path of %s', (_case, binding, args, expected) => {
    expect(resolveTargetPath(args, binding)).toBe(expected)
  })

  it.each([
    ['arguments that are not an object', WRITE, 'file_path=a.md'],
    ['null arguments', WRITE, null],
    ['a missing path argument', WRITE, { content: 'body' }],
    ['a blank path argument', WRITE, { file_path: '' }],
    ['a non-string path argument', WRITE, { file_path: 7 }],
    ['an editor read command', EDITOR, { command: 'view', path: '/sci/memory/a.md' }],
    ['an editor call with no command', EDITOR, { path: '/sci/memory/a.md' }],
  ])('has no target for %s', (_case, binding, args) => {
    expect(resolveTargetPath(args, binding)).toBeUndefined()
  })
})
