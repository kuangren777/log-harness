/**
 * The files mode's pure decisions: path arithmetic, the preview dispatch
 * table, the Viewer target, the produced-file derivation, and the shown-path
 * rule the store's pin participates in.
 */
import { describe, expect, it } from 'vitest'
import type { ConversationNode, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import {
  ancestorsOf, extensionOf, fileName, isConvertibleOfficePath, isHiddenName, isOfficePath, isVersionsDirectory,
} from '../src/client/paths.ts'
import { dataUrl, formatSize, highlightLanguage, previewKindFor } from '../src/client/media.ts'
import { embeddedViewerUrl } from '../src/client/office-url.ts'
import { allLocatedPaths, latestLocatedPath, locatedPath } from '../src/client/auto-locate.ts'
import { toolDisplayName } from '../src/client/tool-names.ts'
import { createSciFilesStore, shownPath } from '../src/client/stores.ts'

/** A settled successful tool result carrying one call's raw arguments. */
function result(name: string, argsRaw: string, overrides: Partial<ToolResultNode> = {}): ConversationNode {
  return {
    kind: 'tool-result', seq: 1, time: 0, callId: 'c1',
    call: { name, argsRaw }, callTime: null, content: [], isError: false,
    callView: null, resultView: null, subCalls: [],
    ...overrides,
  }
}

describe('path arithmetic', () => {
  it('names the trailing segment, ignoring separators of either flavor', () => {
    expect(fileName('/a/b/report.md')).toBe('report.md')
    expect(fileName('C:\\work\\report.md')).toBe('report.md')
    expect(fileName('report.md')).toBe('report.md')
    // Nothing but separators: there is no segment to name, so the input stands.
    expect(fileName('///')).toBe('///')
  })

  it('reads the lowercased extension, and none from a dotfile', () => {
    expect(extensionOf('/a/Report.MD')).toBe('.md')
    expect(extensionOf('/a/Makefile')).toBe('')
    // A leading dot names the file, it does not introduce an extension.
    expect(extensionOf('/a/.gitignore')).toBe('')
  })

  it('routes only .univer to the frame; the OOXML trio is convertible, not framed', () => {
    // The state route refuses everything but .univer — framing a .docx
    // dead-ended in a runtime-unavailable notice (production defect).
    for (const path of ['a.univer', 'A.UNIVER']) {
      expect(isOfficePath(path)).toBe(true)
      expect(isConvertibleOfficePath(path)).toBe(false)
    }
    for (const path of ['a.xlsx', 'a.docx', 'a.pptx', 'A.DOCX']) {
      expect(isOfficePath(path)).toBe(false)
      expect(isConvertibleOfficePath(path)).toBe(true)
    }
    expect(isOfficePath('a.md')).toBe(false)
    expect(isConvertibleOfficePath('a.md')).toBe(false)
  })

  it('tags a versions archive and hides dot-prefixed rows', () => {
    expect(isVersionsDirectory('versions')).toBe(true)
    expect(isVersionsDirectory('versions-old')).toBe(false)
    expect(isHiddenName('.git')).toBe(true)
    expect(isHiddenName('src')).toBe(false)
  })

  it('lists the directories a path needs open, outermost first', () => {
    expect(ancestorsOf('/p/papers/x/versions/v1.pdf', '/p'))
      .toEqual(['/p', '/p/papers', '/p/papers/x', '/p/papers/x/versions'])
    // A trailing separator on the root joins the same way.
    expect(ancestorsOf('/p/a/b.txt', '/p/')).toEqual(['/p', '/p/a'])
    // A direct child needs only the root itself open.
    expect(ancestorsOf('/p/b.txt', '/p')).toEqual(['/p'])
  })

  it('yields no ancestry for a path the root does not contain', () => {
    expect(ancestorsOf('/other/b.txt', '/p')).toEqual([])
    // A sibling whose name merely starts with the root's is not inside it.
    expect(ancestorsOf('/project-2/b.txt', '/p')).toEqual([])
    // The root itself, spelled with and without a trailing separator.
    expect(ancestorsOf('/p', '/p')).toEqual([])
    expect(ancestorsOf('/p/', '/p')).toEqual([])
  })
})

describe('preview dispatch', () => {
  it('sends each media type to the arm that can render it', () => {
    expect(previewKindFor('text/markdown')).toBe('markdown')
    expect(previewKindFor('application/pdf')).toBe('pdf')
    expect(previewKindFor('image/png')).toBe('image')
    expect(previewKindFor('image/svg+xml')).toBe('image')
    expect(previewKindFor('text/x-python')).toBe('text')
    expect(previewKindFor('application/json')).toBe('text')
    expect(previewKindFor('application/x-univer')).toBe('office')
    // The OOXML trio reads as bytes with a conversion hint: the Viewer only
    // opens .univer units, so an office kind here would loop back into the
    // refusing state route.
    expect(previewKindFor('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('binary')
    expect(previewKindFor('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('binary')
    expect(previewKindFor('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('binary')
  })

  it('treats an unlisted type as opaque bytes', () => {
    expect(previewKindFor('application/octet-stream')).toBe('binary')
    expect(previewKindFor('application/zip')).toBe('binary')
  })

  it('builds a data URL per encoding, percent-encoding the text form', () => {
    expect(dataUrl('image/png', 'base64', 'AAA=')).toBe('data:image/png;base64,AAA=')
    expect(dataUrl('image/svg+xml', 'utf8', '<svg id="a#b"/>'))
      .toBe('data:image/svg+xml,%3Csvg%20id%3D%22a%23b%22%2F%3E')
  })

  it('hints the highlighter with the extension, and not at all without one', () => {
    expect(highlightLanguage('/a/main.py')).toBe('py')
    expect(highlightLanguage('/a/Makefile')).toBeUndefined()
  })

  it('formats a size the way a person reads one', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2 KB')
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

describe('viewer target', () => {
  it('embeds the trunk scope and grants editing only with the Gateway up', () => {
    expect(embeddedViewerUrl('/univer-gw/?file=%2Fp%2Fa.univer', true))
      .toBe('/univer-gw/?file=%2Fp%2Fa.univer&mode=embedded&scope=trunk&editable=true')
    expect(embeddedViewerUrl('/univer-gw/?file=%2Fp%2Fa.univer', false))
      .toBe('/univer-gw/?file=%2Fp%2Fa.univer&mode=embedded&scope=trunk&editable=false')
  })

  it('replaces a target that already carries the framing parameters', () => {
    expect(embeddedViewerUrl('/univer-gw/?file=a&mode=standalone&editable=false', true))
      .toBe('/univer-gw/?file=a&mode=embedded&editable=true&scope=trunk')
  })

  // The result is an iframe src; the wire adapter already refuses these, and
  // this is the independent second line on the same sink.
  it('refuses a target that is not a relative Viewer path', () => {
    for (const hostile of [
      'javascript:alert(document.domain)',
      'data:text/html,<script>alert(1)</script>',
      'https://evil.example/univer-gw/?file=a',
      '//evil.example/univer-gw/?file=a',
    ]) {
      expect(() => embeddedViewerUrl(hostile, true)).toThrow(/refusing to frame/)
    }
  })

  it('refuses a same-origin path outside the Viewer prefix, traversal included', () => {
    expect(() => embeddedViewerUrl('/api/session.list', true)).toThrow(/refusing to frame/)
    // Normalization is why the PARSED pathname is what gets checked.
    expect(() => embeddedViewerUrl('/univer-gw/../evil/page.html', true)).toThrow(/refusing to frame/)
  })
})

describe('produced-file derivation', () => {
  it('reads the path each locating tool names in its arguments', () => {
    expect(locatedPath('univer_new', '{"file":"/p/w/book.univer"}')).toBe('/p/w/book.univer')
    expect(locatedPath('univer_export', '{"file":"/p/w/book.univer","output":"/p/out/book.xlsx"}'))
      .toBe('/p/out/book.xlsx')
    expect(locatedPath('deliver_files', '{"files":[{"path":"/p/d/a.pdf"},{"path":"/p/d/b.pdf"}]}'))
      .toBe('/p/d/b.pdf')
  })

  it('locates nothing from a tool it does not know', () => {
    expect(locatedPath('write_file', '{"path":"/p/a.txt"}')).toBeUndefined()
  })

  it('locates nothing from arguments it cannot read', () => {
    expect(locatedPath('univer_new', '{"file":')).toBeUndefined()
    expect(locatedPath('univer_new', '"a string"')).toBeUndefined()
    expect(locatedPath('univer_new', 'null')).toBeUndefined()
    expect(locatedPath('univer_new', '{}')).toBeUndefined()
    expect(locatedPath('univer_new', '{"file":42}')).toBeUndefined()
    expect(locatedPath('univer_new', '{"file":"   "}')).toBeUndefined()
    expect(locatedPath('deliver_files', '{"files":"not-an-array"}')).toBeUndefined()
    expect(locatedPath('deliver_files', '{"files":[]}')).toBeUndefined()
    expect(locatedPath('deliver_files', '{"files":[null,{"title":"no path"}]}')).toBeUndefined()
  })

  it('falls back through a trailing delivery entry that names no path', () => {
    expect(locatedPath('deliver_files', '{"files":[{"path":"/p/d/a.pdf"},{"title":"anonymous"}]}'))
      .toBe('/p/d/a.pdf')
  })

  it('takes the newest locating call in the window', () => {
    const nodes = [
      result('univer_new', '{"file":"/p/w/book.univer"}'),
      result('write_file', '{"path":"/p/w/notes.md"}'),
      result('univer_export', '{"output":"/p/out/book.xlsx"}'),
    ]
    expect(latestLocatedPath(nodes)).toBe('/p/out/book.xlsx')
  })

  it('ignores failed calls, call-less results, and non-tool nodes', () => {
    expect(latestLocatedPath([])).toBeUndefined()
    expect(latestLocatedPath([
      result('univer_new', '{"file":"/p/a.univer"}'),
      result('univer_export', '{"output":"/p/failed.xlsx"}', { isError: true }),
      result('univer_export', '{"output":"/p/windowless.xlsx"}', { call: null }),
      { kind: 'assistant-message', seq: 9 } as unknown as ConversationNode,
    ])).toBe('/p/a.univer')
  })
})

describe('produced-file collection', () => {
  it('collects every produced file in the window, oldest first', () => {
    expect(allLocatedPaths([
      result('univer_new', '{"file":"/p/w/book.univer"}'),
      result('write_file', '{"path":"/p/w/notes.md"}'),
      result('deliver_files', '{"files":[{"path":"/p/d/a.pdf"},{"path":"/p/d/b.pdf"}]}'),
    ])).toEqual(['/p/w/book.univer', '/p/d/b.pdf'])
  })

  it('keeps only the newest position of a file produced twice', () => {
    expect(allLocatedPaths([
      result('univer_export', '{"output":"/p/out/a.xlsx"}'),
      result('univer_new', '{"file":"/p/w/book.univer"}'),
      result('univer_export', '{"output":"/p/out/a.xlsx"}'),
    ])).toEqual(['/p/w/book.univer', '/p/out/a.xlsx'])
  })

  it('collects nothing from a window that produced nothing', () => {
    expect(allLocatedPaths([])).toEqual([])
    expect(allLocatedPaths([
      result('univer_export', '{"output":"/p/failed.xlsx"}', { isError: true }),
      result('write_file', '{"path":"/p/a.txt"}'),
    ])).toEqual([])
  })
})

describe('tool display names', () => {
  it('names the tools a research session runs', () => {
    expect(toolDisplayName('web_search')).toBe('网页搜索')
    expect(toolDisplayName('literature_search')).toBe('文献检索')
    expect(toolDisplayName('web_fetch')).toBe('网页浏览')
    expect(toolDisplayName('bash')).toBe('命令执行')
    expect(toolDisplayName('read')).toBe('读取文件')
    expect(toolDisplayName('write')).toBe('写入文件')
    expect(toolDisplayName('edit')).toBe('修改文件')
    expect(toolDisplayName('subagent')).toBe('子智能体')
    expect(toolDisplayName('workflow')).toBe('多智能体流程')
    expect(toolDisplayName('skill')).toBe('技能')
    expect(toolDisplayName('deliver_files')).toBe('交付文件')
    expect(toolDisplayName('declare_research_plan')).toBe('研究计划')
    expect(toolDisplayName('todo')).toBe('任务清单')
    expect(toolDisplayName('ask_user')).toBe('询问用户')
  })

  it('shares one noun across the office runtime family', () => {
    expect(toolDisplayName('univer_new')).toBe('文档操作')
    expect(toolDisplayName('univer_export')).toBe('文档操作')
  })

  it('shows an unmapped tool under the name it was called by', () => {
    expect(toolDisplayName('grep')).toBe('grep')
    expect(toolDisplayName('')).toBe('')
  })
})

describe('shown path', () => {
  it('follows what the session produced while nothing is pinned', () => {
    expect(shownPath(null, '/p/out/a.xlsx')).toBe('/p/out/a.xlsx')
    expect(shownPath(null, undefined)).toBeUndefined()
  })

  it('keeps the pick while it still outranks the produced state it was made over', () => {
    expect(shownPath({ path: '/p/notes.md', over: '/p/out/a.xlsx' }, '/p/out/a.xlsx')).toBe('/p/notes.md')
    expect(shownPath({ path: '/p/notes.md', over: null }, undefined)).toBe('/p/notes.md')
  })

  it('yields to a newer production, so a second delivery locates itself', () => {
    expect(shownPath({ path: '/p/notes.md', over: '/p/out/a.xlsx' }, '/p/out/b.xlsx')).toBe('/p/out/b.xlsx')
    expect(shownPath({ path: '/p/notes.md', over: null }, '/p/out/first.xlsx')).toBe('/p/out/first.xlsx')
  })
})

describe('files store', () => {
  it('records a pick against the produced state and toggles open directories', () => {
    const instance = createSciFilesStore().create('s1')
    expect(instance.getSnapshot()).toEqual({ pinned: null, expanded: [] })

    instance.actions.pin('/p/notes.md', '/p/out/a.xlsx')
    expect(instance.getSnapshot().pinned).toEqual({ path: '/p/notes.md', over: '/p/out/a.xlsx' })

    instance.actions.toggleExpanded('/p/src')
    expect(instance.getSnapshot().expanded).toEqual(['/p/src'])
    instance.actions.toggleExpanded('/p/out')
    expect(instance.getSnapshot().expanded).toEqual(['/p/src', '/p/out'])
    instance.actions.toggleExpanded('/p/src')
    expect(instance.getSnapshot().expanded).toEqual(['/p/out'])
  })
})
