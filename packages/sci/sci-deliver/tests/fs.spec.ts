// The adapter is the only place this package touches `ctx.fs`, so it is tested
// against the real local backend: what matters is that an absent directory
// lists empty rather than throwing, and that the asset walk honours its depth.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createDeliveryFileSystem, normalizeSegments } from '@deepseek-ai/dsh-sci-deliver'
import type { DeliveryFileSystem } from '@deepseek-ai/dsh-sci-deliver'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot the local filesystem over a fresh temporary root. */
async function boot(): Promise<{ fs: DeliveryFileSystem; root: string }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-deliver-fs-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(LocalFileSystem, { cwd: root })
  return { fs: createDeliveryFileSystem(ctx), root }
}

/** The path as this package keys it, so an assertion is separator-neutral. */
function canonical(path: string): string {
  return `/${normalizeSegments(path).join('/')}`
}

describe('createDeliveryFileSystem', () => {
  it('resolves a relative path against an explicit working directory', async () => {
    const { fs, root: base } = await boot()
    await mkdir(join(base, 'workspace'), { recursive: true })
    await writeFile(join(base, 'workspace', 'report.md'), '# Report\n')

    const resolved = await fs.resolve('report.md', join(base, 'workspace'))

    expect(canonical(resolved)).toBe(canonical(join(base, 'workspace', 'report.md')))
    expect(await fs.exists(resolved)).toBe(true)
    expect(await fs.isFile(resolved)).toBe(true)
    expect(await fs.readText(resolved)).toBe('# Report\n')
  })

  it('resolves against the backend default when no working directory is given', async () => {
    const { fs, root: base } = await boot()
    await writeFile(join(base, 'note.md'), 'x')

    expect(canonical(await fs.resolve('note.md'))).toBe(canonical(join(base, 'note.md')))
  })

  it('reports an absent path and a directory as not a regular file', async () => {
    const { fs, root: base } = await boot()
    await mkdir(join(base, 'workspace'), { recursive: true })

    expect(await fs.exists(join(base, 'missing.md'))).toBe(false)
    expect(await fs.isFile(join(base, 'missing.md'))).toBe(false)
    expect(await fs.exists(join(base, 'workspace'))).toBe(true)
    expect(await fs.isFile(join(base, 'workspace'))).toBe(false)
  })

  it('round-trips bytes and creates parent directories on write', async () => {
    const { fs, root: base } = await boot()
    await writeFile(join(base, 'fig.bin'), Buffer.from([0, 1, 2, 3]))

    expect([...await fs.readBytes(join(base, 'fig.bin'), 1024)]).toEqual([0, 1, 2, 3])
    await fs.writeText(join(base, 'deliveries', 'd1', 'copy.txt'), 'copied')
    expect(await fs.readText(join(base, 'deliveries', 'd1', 'copy.txt'))).toBe('copied')
  })

  it('lists only the regular files of a directory, and nothing for an absent one', async () => {
    const { fs, root: base } = await boot()
    const pending = join(base, 'spool', 'pending')
    await mkdir(join(pending, 'nested'), { recursive: true })
    await writeFile(join(pending, '02.json'), '{}')
    await writeFile(join(pending, '01.json'), '{}')

    expect(await fs.listFiles(pending)).toEqual(['01.json', '02.json'])
    expect(await fs.listFiles(join(base, 'spool', 'done'))).toEqual([])
    expect(await fs.listFiles(join(pending, '01.json'))).toEqual([])
  })

  it('walks assets to the requested depth and no further', async () => {
    const { fs, root: base } = await boot()
    const bundle = join(base, 'workspace')
    await mkdir(join(bundle, 'assets', 'deep'), { recursive: true })
    await writeFile(join(bundle, 'board.canvas'), '{}')
    await writeFile(join(bundle, 'assets', 'hero.png'), 'x')
    await writeFile(join(bundle, 'assets', 'deep', 'buried.png'), 'x')

    expect([...await fs.listAssets(bundle, 3)].sort())
      .toEqual(['assets/deep/buried.png', 'assets/hero.png', 'board.canvas'])
    expect([...await fs.listAssets(bundle, 2)].sort()).toEqual(['assets/hero.png', 'board.canvas'])
    expect([...await fs.listAssets(bundle, 1)]).toEqual(['board.canvas'])
    expect([...await fs.listAssets(join(base, 'absent'), 3)]).toEqual([])
  })
})
