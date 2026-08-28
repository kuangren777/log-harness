// The shell the model's files pass through is pinned verbatim: every path and
// exclude pattern is a single quoted word, the archive travels as base64 on
// stdout, and an archive over the cap is refused before anything is imported.
import { describe, expect, it, vi } from 'vitest'
import { CommandExitError } from '@deepseek-ai/dsh-e2b'
import type { Sandbox } from '@deepseek-ai/dsh-e2b'
import {
  IMPORT_ARCHIVE,
  exportWorkspace,
  importWorkspace,
  insideWorkspace,
  tarExportCommand,
  tarImportCommand,
} from '@deepseek-ai/dsh-camel-runtime'

type Run = (command: string, options?: { envs?: Record<string, string> }) => Promise<{ exitCode: number; stdout: string; stderr: string }>
type Write = (path: string, data: ArrayBuffer) => Promise<void>

interface Fake {
  sandbox: Sandbox
  run: ReturnType<typeof vi.fn<Run>>
  write: ReturnType<typeof vi.fn<Write>>
}

function fake(): Fake {
  const run = vi.fn<Run>().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
  const write = vi.fn<Write>().mockResolvedValue(undefined)
  return { sandbox: { commands: { run }, files: { write } } as unknown as Sandbox, run, write }
}

describe('tarExportCommand', () => {
  it('quotes the directory and every exclude pattern as one shell word each', () => {
    expect(tarExportCommand('/home/user/it\'s', ['./.sci', '*/node_modules']))
      .toBe('tar -czf - -C \'/home/user/it\'"\'"\'s\' --exclude=\'./.sci\' --exclude=\'*/node_modules\' . | base64 -w0')
  })

  it('emits no exclude flag when nothing is excluded', () => {
    expect(tarExportCommand('/w', [])).toBe('tar -czf - -C \'/w\'  . | base64 -w0')
  })
})

describe('tarImportCommand', () => {
  it('creates the destination, extracts, and removes the archive', () => {
    expect(tarImportCommand('/tmp/a.tgz', '/w/out'))
      .toBe('mkdir -p \'/w/out\' && tar -xzf \'/tmp/a.tgz\' -C \'/w/out\' && rm -f \'/tmp/a.tgz\'')
  })
})

describe('exportWorkspace', () => {
  it('decodes the base64 stdout into the archive bytes', async () => {
    const { sandbox, run } = fake()
    run.mockResolvedValue({ exitCode: 0, stdout: `${Buffer.from('tarbytes').toString('base64')}\n`, stderr: '' })
    const bytes = await exportWorkspace(sandbox, '/w', { excludes: ['./.sci'], maxBytes: 1024 })
    expect(bytes.toString('utf8')).toBe('tarbytes')
    const [command, options] = run.mock.calls[0]!
    expect(command).toBe(tarExportCommand('/w', ['./.sci']))
    // The SDK's login shell is pointed at a throwaway home so the user's profile never runs.
    expect(options?.envs?.HOME).toMatch(/^\/\.dsh-e2b-control-/)
  })

  it('refuses an archive over the cap (T2)', async () => {
    const { sandbox, run } = fake()
    run.mockResolvedValue({ exitCode: 0, stdout: Buffer.alloc(9).toString('base64'), stderr: '' })
    await expect(exportWorkspace(sandbox, '/w', { excludes: [], maxBytes: 8 }))
      .rejects.toThrow('camel-runtime: workspace archive is 9 bytes, over the 8-byte cap; exclude large files or raise maxWorkspaceBytes')
  })

  it('reports a failing tar with its exit code and stderr', async () => {
    const { sandbox, run } = fake()
    run.mockResolvedValue({ exitCode: 2, stdout: '', stderr: 'tar: /w: Cannot open\n' })
    await expect(exportWorkspace(sandbox, '/w', { excludes: [], maxBytes: 8 }))
      .rejects.toThrow('camel-runtime: exporting /w failed (exit 2): tar: /w: Cannot open')
  })
})

describe('importWorkspace', () => {
  it('uploads the archive then extracts it in place', async () => {
    const { sandbox, run, write } = fake()
    await importWorkspace(sandbox, Buffer.from('tarbytes'), '/w')
    expect(write).toHaveBeenCalledTimes(1)
    const [path, data] = write.mock.calls[0]!
    expect(path).toBe(IMPORT_ARCHIVE)
    expect(Buffer.from(data).toString('utf8')).toBe('tarbytes')
    expect(run).toHaveBeenCalledWith(tarImportCommand(IMPORT_ARCHIVE, '/w'), expect.anything())
  })

  it('reports a failing extraction', async () => {
    const { sandbox, run } = fake()
    run.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'gzip: stdin: not in gzip format' })
    await expect(importWorkspace(sandbox, Buffer.from('x'), '/w'))
      .rejects.toThrow('camel-runtime: importing into /w failed (exit 1): gzip: stdin: not in gzip format')
  })

  it('lets the SDK exit error through unchanged, since the caller decides how to read it', async () => {
    const { sandbox, run } = fake()
    run.mockRejectedValue(new CommandExitError({ exitCode: 1, stdout: '', stderr: 'boom' }))
    await expect(importWorkspace(sandbox, Buffer.from('x'), '/w')).rejects.toBeInstanceOf(CommandExitError)
  })
})

describe('insideWorkspace', () => {
  it('resolves a relative directory under the workspace', () => {
    expect(insideWorkspace('/w', 'out/figs/')).toBe('/w/out/figs')
    expect(insideWorkspace('/w', '.')).toBe('/w')
  })

  it.each(['/etc', '../x', 'a/../../x'])('refuses %s', (relative) => {
    expect(() => insideWorkspace('/w', relative)).toThrow(`camel-runtime: ${relative} is outside the workspace /w`)
  })
})
