// The two skill sources behind the plugin: a local directory for tests and the
// loopback HTTP vault for deployment. The HTTP source caches the catalog for a
// window, keeps serving the last good catalog when a refresh fails, and fails
// the first read when it has nothing cached.
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DirectoryVaultSource, HttpVaultSource, type SkillCatalogEntry } from '@deepseek-ai/dsh-sci-skills'

const sha = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')

let root: string | undefined
let server: Server | undefined

afterEach(async () => {
  if (server !== undefined) await new Promise<void>(resolve => server!.close(() => { resolve() }))
  server = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Lay out a one-skill directory tree.
 * @param body - the SKILL.md instruction body.
 * @param extra - non-SKILL.md files keyed by relative path.
 * @returns the skill root.
 */
async function tree(body: string, extra: Record<string, string> = {}): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-vault-'))
  const dir = join(root, 'skills', 'sci-plot')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: sci-plot\ndescription: Render figures.\n---\n\n${body}\n`)
  for (const [rel, content] of Object.entries(extra)) {
    await mkdir(join(dir, ...rel.split('/').slice(0, -1)), { recursive: true })
    await writeFile(join(dir, rel), content)
  }
  return join(root, 'skills')
}

describe('DirectoryVaultSource', () => {
  it('serves the catalog, an object by digest, and a file, excluding SKILL.md from files', async () => {
    const skillRoot = await tree('Body one.', { 'render.py': 'print(1)' })
    const source = new DirectoryVaultSource(skillRoot)

    const catalog = await source.catalog()
    expect(catalog.map(entry => entry.name)).toEqual(['sci-plot'])
    expect(Object.keys(catalog[0]!.files)).toEqual(['render.py'])
    expect(catalog[0]!.bodySha256).toBe(sha('Body one.'))
    await expect(source.object(sha('Body one.'))).resolves.toBe('Body one.')
    await expect(source.file('sci-plot', 'render.py')).resolves.toBe('print(1)')
  })

  it('rejects an unknown object digest', async () => {
    const source = new DirectoryVaultSource(await tree('Body.'))
    await source.catalog()
    await expect(source.object('0'.repeat(64))).rejects.toThrow(/no skill body with digest/)
  })

  it('carries whenToUse and metadata from the frontmatter into the catalog', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-sci-vault-'))
    const dir = join(root, 'skills', 'sci-plot')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'SKILL.md'),
      '---\nname: sci-plot\ndescription: Render figures.\nwhenToUse: when a figure is asked for\nmetadata:\n  origin: in-house\n---\n\nBody.\n',
    )
    const [entry] = await new DirectoryVaultSource(join(root, 'skills')).catalog()

    expect(entry).toMatchObject({ whenToUse: 'when a figure is asked for', metadata: { origin: 'in-house' } })
  })
})

/** One catalog entry the HTTP stub serves. */
const ENTRY: SkillCatalogEntry = {
  name: 'sci-plot',
  description: 'Render figures.',
  invocation: { modelInvocable: true, userInvocable: true },
  bodySha256: sha('BODY'),
  files: { 'render.py': sha('print(1)') },
}

/**
 * Start an HTTP vault stub whose handler the test supplies per case.
 * @param handler - decides the response for each request path.
 * @returns the base URL.
 */
async function stub(handler: (path: string) => { status: number; body: string }): Promise<string> {
  server = createServer((req, res) => {
    const { status, body } = handler(req.url ?? '')
    res.writeHead(status)
    res.end(body)
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => { resolve() }))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('vault stub has no port')
  return `http://127.0.0.1:${address.port}`
}

function config(url: string) {
  return { url, token: 'vm-token', timeoutMs: 10_000 }
}

describe('HttpVaultSource', () => {
  it('fetches the catalog, an object, and a file with the bearer, honouring a caller signal', async () => {
    const auth: string[] = []
    const url = await stub((path) => {
      if (path === '/v1/catalog') return { status: 200, body: JSON.stringify({ skills: [ENTRY] }) }
      if (path === `/v1/objects/${sha('BODY')}`) return { status: 200, body: 'BODY' }
      if (path === '/v1/skills/sci-plot/files/render.py') return { status: 200, body: 'print(1)' }
      return { status: 404, body: 'no' }
    })
    server!.on('request', req => auth.push(req.headers.authorization ?? ''))
    const source = new HttpVaultSource(config(url))

    expect((await source.catalog()).map(entry => entry.name)).toEqual(['sci-plot'])
    // The caller signal is combined with the per-request timeout.
    await expect(source.object(sha('BODY'), new AbortController().signal)).resolves.toBe('BODY')
    await expect(source.file('sci-plot', 'render.py', new AbortController().signal)).resolves.toBe('print(1)')
    expect(auth.every(header => header === 'Bearer vm-token')).toBe(true)
  })

  it('fails loud on a non-ok status', async () => {
    const url = await stub(() => ({ status: 503, body: 'down' }))
    await expect(new HttpVaultSource(config(url)).catalog()).rejects.toThrow(/returned 503/)
    await expect(new HttpVaultSource(config(url)).object(sha('BODY'))).rejects.toThrow(/returned 503/)
  })
})
