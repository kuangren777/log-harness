// Tool names and argument names are configuration, so the reading of one call
// through its binding is pinned separately from the gate: a multi-command tool
// must land on the operation ITS sub-command performs, or `str_replace_editor
// view` would be judged as an edit.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FS_TOOLS,
  indexFsTools,
  readBooleanArg,
  readStringArg,
  reconstructAfter,
  resolveFsOp,
} from '@deepseek-ai/dsh-sci-workspace'
import type { FsToolBinding } from '@deepseek-ai/dsh-sci-workspace'

const EDIT_BINDING = DEFAULT_FS_TOOLS.edit[0] as FsToolBinding
const STR_REPLACE_BINDING = DEFAULT_FS_TOOLS.edit[1] as FsToolBinding

describe('indexFsTools', () => {
  it('indexes the shipped tool set by name and keeps the class each was declared in', () => {
    const { fs, shell } = indexFsTools(DEFAULT_FS_TOOLS)
    expect(fs.get('read')?.defaultOp).toBe('read')
    expect(fs.get('write')?.defaultOp).toBe('write')
    expect(fs.get('edit')?.defaultOp).toBe('edit')
    expect(fs.get('str_replace_editor')?.defaultOp).toBe('edit')
    expect([...shell.keys()]).toEqual(['bash', 'terminal_send'])
  })

  it('refuses a tool name claimed by two classes, whose operation would depend on map order', () => {
    expect(() => indexFsTools({
      ...DEFAULT_FS_TOOLS,
      read: [{ name: 'write', path: 'file_path' }],
    })).toThrow(/more than one fsTools class/)
    expect(() => indexFsTools({
      ...DEFAULT_FS_TOOLS,
      shell: [{ name: 'read', command: 'command' }],
    })).toThrow(/more than one fsTools class/)
  })
})

describe('resolveFsOp', () => {
  it('keeps a single-operation tool on its declared class', () => {
    const entry = { defaultOp: 'edit' as const, binding: EDIT_BINDING }
    expect(resolveFsOp(entry, { file_path: '/x', old_string: 'a', new_string: 'b' })).toBe('edit')
  })

  it('maps each sub-command of a multi-command tool onto the operation it performs', () => {
    const entry = { defaultOp: 'edit' as const, binding: STR_REPLACE_BINDING }
    expect(resolveFsOp(entry, { command: 'view', path: '/x' })).toBe('read')
    expect(resolveFsOp(entry, { command: 'create', path: '/x', file_text: '{}' })).toBe('write')
    expect(resolveFsOp(entry, { command: 'str_replace', path: '/x' })).toBe('edit')
    expect(resolveFsOp(entry, { command: 'insert', path: '/x' })).toBe('edit')
  })

  it('keeps an unmapped or missing sub-command on the declared class, which is the stricter reading', () => {
    const entry = { defaultOp: 'edit' as const, binding: STR_REPLACE_BINDING }
    expect(resolveFsOp(entry, { command: 'undo_edit', path: '/x' })).toBe('edit')
    expect(resolveFsOp(entry, { path: '/x' })).toBe('edit')
  })
})

describe('reconstructAfter', () => {
  it('takes a whole-content argument as the result', () => {
    expect(reconstructAfter(DEFAULT_FS_TOOLS.write[0] as FsToolBinding, { content: 'new' }, 'old')).toBe('new')
  })

  it('applies a replacement pair to the content on disk, honoring replace_all', () => {
    expect(reconstructAfter(EDIT_BINDING, { old_string: 'a', new_string: 'X' }, 'a b a')).toBe('X b a')
    expect(reconstructAfter(EDIT_BINDING, { old_string: 'a', new_string: 'X', replace_all: true }, 'a b a')).toBe('X b X')
  })

  it('treats an absent file as empty content', () => {
    expect(reconstructAfter(EDIT_BINDING, { old_string: '', new_string: 'X' }, undefined)).toBe('X')
  })

  it('reports nothing for a call carrying neither form, such as an insert', () => {
    expect(reconstructAfter(STR_REPLACE_BINDING, { command: 'insert', insert_line: 3, new_str: 'x' }, '{}')).toBeUndefined()
    expect(reconstructAfter(EDIT_BINDING, { old_string: 'a' }, '{}')).toBeUndefined()
  })
})

describe('argument readers at the model/tool JSON boundary', () => {
  it('reads a string argument and rejects a missing name, a wrong type, and a non-object payload', () => {
    expect(readStringArg({ path: '/x' }, 'path')).toBe('/x')
    expect(readStringArg({ path: 3 }, 'path')).toBeUndefined()
    expect(readStringArg({ path: '/x' }, undefined)).toBeUndefined()
    expect(readStringArg('not an object', 'path')).toBeUndefined()
    expect(readStringArg(null, 'path')).toBeUndefined()
  })

  it('reads a boolean argument as true only when it is literally true', () => {
    expect(readBooleanArg({ replace_all: true }, 'replace_all')).toBe(true)
    expect(readBooleanArg({ replace_all: 'true' }, 'replace_all')).toBe(false)
    expect(readBooleanArg({}, 'replace_all')).toBe(false)
    expect(readBooleanArg({ replace_all: true }, undefined)).toBe(false)
    expect(readBooleanArg(null, 'replace_all')).toBe(false)
  })
})
