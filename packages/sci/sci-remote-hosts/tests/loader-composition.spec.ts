// Proves the block writer is real, Loader-composed configurability rather than
// a hand-built ctx.plugin() suite: a cordis.yml booted through the real Loader
// mounts a real filesystem, the real credential provider, and this package, and
// the managed block, the key file, and the credential record all appear from
// that composition alone.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SciRemoteHostsService, { CREDENTIAL_SCOPE, MANAGED_BLOCK_START } from '@deepseek-ai/dsh-sci-remote-hosts'

const PRIVATE_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nc2VjcmV0\n-----END OPENSSH PRIVATE KEY-----\n'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

interface Booted {
  readonly ctx: Context
  readonly configPath: string
  readonly identityDir: string
}

/**
 * Boot a cordis.yml carrying the given sci-remote-hosts config block.
 * @param configLines - the indented config lines for the sci-remote-hosts entry.
 * @returns the booted context and the paths the composition gave the plugin.
 */
async function boot(configLines?: readonly string[]): Promise<Booted> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-remote-hosts-loader-'))
  const identityDir = join(root, 'home', '.ssh')
  await mkdir(identityDir, { recursive: true })
  const configPath = join(identityDir, 'config')
  await writeFile(configPath, 'Host jump\n    HostName jump.example.net\n    ProxyJump bastion\n')

  const declared = configLines ?? [
    `    sshConfigPath: ${JSON.stringify(configPath)}`,
    `    identityDir: ${JSON.stringify(identityDir)}`,
  ]
  const cordisPath = join(root, 'cordis.yml')
  await writeFile(cordisPath, [
    "- name: '@deepseek-ai/dsh-fs-local'",
    '  config:',
    `    cwd: ${JSON.stringify(root)}`,
    "- name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(join(root, 'credentials.yaml'))}`,
    '    watch: false',
    "- name: '@deepseek-ai/dsh-sci-remote-hosts'",
    '  config:',
    ...declared,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-sci-remote-hosts', SciRemoteHostsService],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(cordisPath).href } })
  await ctx.loader.await()
  return { ctx, configPath, identityDir }
}

describe('sci-remote-hosts real Loader composition through cordis.yml', () => {
  it('writes the managed block, the key, and the credential record from the composed tree', async () => {
    const booted = await boot()

    const result = await booted.ctx.sciRemoteHosts.upsert({
      alias: 'gpu-lab',
      hostName: 'gpu.example.com',
      user: 'ubuntu',
      privateKey: PRIVATE_KEY,
    })

    expect(result.ok && result.value.hosts.map(host => host.alias)).toEqual(['gpu-lab'])
    const config = await readFile(booted.configPath, 'utf8')
    expect(config.startsWith('Host jump\n    HostName jump.example.net\n    ProxyJump bastion\n')).toBe(true)
    expect(config).toContain(`${MANAGED_BLOCK_START}\nHost gpu-lab\n`)
    expect(config).toContain('    BatchMode yes\n')
    expect(config).toContain('    ConnectTimeout 10\n')
    expect(config).toContain('    ServerAliveInterval 30\n')
    await expect(readFile(join(booted.identityDir, 'sci-gpu-lab'), 'utf8')).resolves.toBe(PRIVATE_KEY)
    await expect(booted.ctx.credentials.readRecord(credentialKey(CREDENTIAL_SCOPE, 'gpu-lab'))).resolves.toBeDefined()
  }, 30_000)

  it.each([
    { label: 'the ssh config path is omitted', lines: ['    identityDir: /home/user/.ssh'], failure: /sshConfigPath/ },
    { label: 'the ssh config path is relative', lines: ['    sshConfigPath: .ssh/config', '    identityDir: /home/user/.ssh'], failure: /must be an absolute path/ },
    { label: 'the identity directory is relative', lines: ['    sshConfigPath: /home/user/.ssh/config', '    identityDir: .ssh'], failure: /identityDir must be an absolute path/ },
    { label: 'the connect timeout is fractional', lines: ['    sshConfigPath: /home/user/.ssh/config', '    identityDir: /home/user/.ssh', '    connectTimeoutSeconds: 1.5'], failure: /connectTimeoutSeconds/ },
  ])('fails loading when $label', async ({ lines, failure }) => {
    await expect(boot(lines)).rejects.toThrow(failure)
  }, 30_000)
})
