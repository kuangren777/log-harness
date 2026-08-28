// The four host endpoints over a real temporary filesystem and a real
// credential provider: what upsert writes, what list reports, what a switched
// off host looks like on disk, and what a removal leaves behind.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import SciRemoteHostsService, {
  CREDENTIAL_SCOPE,
  HOSTS_NAMESPACE,
  MANAGED_BLOCK_END,
  MANAGED_BLOCK_START,
  SERVICE_KEY,
} from '@deepseek-ai/dsh-sci-remote-hosts'
import type { UpsertHostRequest } from '@deepseek-ai/dsh-sci-remote-hosts'

const PRIVATE_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nc2VjcmV0\n-----END OPENSSH PRIVATE KEY-----\n'

const GPU: UpsertHostRequest = {
  alias: 'gpu-lab',
  hostName: 'gpu.example.com',
  user: 'ubuntu',
  privateKey: PRIVATE_KEY,
}

/** The user's own plumbing, written before the plugin ever touches the file. */
const OUTSIDE = [
  'Host jump',
  '    HostName jump.example.net',
  '    User operator',
  '',
  'Host behind-jump',
  '    HostName 192.168.1.10',
  '    ProxyJump jump',
  '',
].join('\n')

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
  /** Absolute path of the managed ssh config. */
  readonly configPath: string
  /** Absolute directory the private keys land in. */
  readonly identityDir: string
}

/**
 * Compose the service over a real local filesystem and credential store.
 * @param existingConfig - content to write to the ssh config before booting, or `undefined` to leave it absent.
 * @returns the booted context and the two paths the service owns.
 */
async function boot(existingConfig?: string): Promise<Booted> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-remote-hosts-'))
  const identityDir = join(root, 'home', '.ssh')
  await mkdir(identityDir, { recursive: true })
  const configPath = join(identityDir, 'config')
  if (existingConfig !== undefined) await writeFile(configPath, existingConfig)
  const ctx = new Context()
  context = ctx
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(LocalCredentialProvider, { path: join(root, 'credentials.yaml'), watch: false })
  await ctx.plugin(SciRemoteHostsService, {
    sshConfigPath: configPath,
    identityDir,
    connectTimeoutSeconds: 10,
    serverAliveIntervalSeconds: 30,
  })
  await ctx.fiber.await()
  return { ctx, configPath, identityDir }
}

/** The ssh config as it stands on disk. */
function readConfig(booted: Booted): Promise<string> {
  return readFile(booted.configPath, 'utf8')
}

describe('sci.hosts endpoints', () => {
  it('exports the four endpoints under the sci.hosts namespace', async () => {
    const booted = await boot()

    const binding = booted.ctx.sciRemoteHosts.typertRemote
    expect(binding.serviceKey).toBe(SERVICE_KEY)
    expect(binding.namespace).toBe(HOSTS_NAMESPACE)
    expect(remoteMethods(booted.ctx.sciRemoteHosts).map(marker => marker.exportName ?? marker.method))
      .toEqual(['list', 'upsert', 'remove', 'toggle'])
  })

  it('lists nothing while the config file does not exist yet', async () => {
    const booted = await boot()

    await expect(booted.ctx.sciRemoteHosts.list()).resolves.toEqual({ ok: true, value: { hosts: [] } })
  })

  it('registers one host, writes its key, and reports it back', async () => {
    const booted = await boot()

    const result = await booted.ctx.sciRemoteHosts.upsert({ ...GPU, port: 2222 })

    expect(result).toEqual({
      ok: true,
      value: {
        hosts: [{
          alias: 'gpu-lab',
          hostName: 'gpu.example.com',
          user: 'ubuntu',
          port: 2222,
          enabled: true,
          identityFile: join(booted.identityDir, 'sci-gpu-lab'),
        }],
      },
    })
    await expect(readFile(join(booted.identityDir, 'sci-gpu-lab'), 'utf8')).resolves.toBe(PRIVATE_KEY)
    await expect(booted.ctx.credentials.readRecord(credentialKey(CREDENTIAL_SCOPE, 'gpu-lab'))).resolves.toEqual({
      kind: 'grant',
      payload: { privateKey: PRIVATE_KEY },
    })
  })

  it('never writes key material into the config file', async () => {
    const booted = await boot()

    await booted.ctx.sciRemoteHosts.upsert(GPU)

    const config = await readConfig(booted)
    expect(config).not.toContain('c2VjcmV0')
    expect(config).not.toContain('PRIVATE KEY')
    expect(config).toContain(`    IdentityFile ${join(booted.identityDir, 'sci-gpu-lab')}`)
  })

  it('leaves the user ProxyJump chain outside the block untouched', async () => {
    const booted = await boot(OUTSIDE)

    await booted.ctx.sciRemoteHosts.upsert(GPU)

    const config = await readConfig(booted)
    expect(config.startsWith(OUTSIDE)).toBe(true)
    expect(config.slice(OUTSIDE.length).startsWith(MANAGED_BLOCK_START)).toBe(true)
    expect(config.trimEnd().endsWith(MANAGED_BLOCK_END)).toBe(true)
  })

  it('is idempotent across two identical registrations', async () => {
    const booted = await boot(OUTSIDE)

    await booted.ctx.sciRemoteHosts.upsert(GPU)
    const once = await readConfig(booted)
    await booted.ctx.sciRemoteHosts.upsert(GPU)

    await expect(readConfig(booted)).resolves.toBe(once)
  })

  it('replaces an entry that already carries the alias instead of duplicating it', async () => {
    const booted = await boot()

    await booted.ctx.sciRemoteHosts.upsert({ ...GPU, port: 2222 })
    const result = await booted.ctx.sciRemoteHosts.upsert({ ...GPU, hostName: 'gpu2.example.com' })

    expect(result.ok && result.value.hosts).toEqual([
      { alias: 'gpu-lab', hostName: 'gpu2.example.com', user: 'ubuntu', enabled: true, identityFile: join(booted.identityDir, 'sci-gpu-lab') },
    ])
    expect((await readConfig(booted)).split('\n').filter(line => line.endsWith('Host gpu-lab'))).toHaveLength(1)
  })

  it('comments a switched-off host out and keeps listing it', async () => {
    const booted = await boot()
    await booted.ctx.sciRemoteHosts.upsert(GPU)

    const result = await booted.ctx.sciRemoteHosts.toggle({ alias: 'gpu-lab', enabled: false })

    expect(result.ok && result.value.hosts[0]?.enabled).toBe(false)
    expect(await readConfig(booted)).toContain('# Host gpu-lab\n')
    await expect(readFile(join(booted.identityDir, 'sci-gpu-lab'), 'utf8')).resolves.toBe(PRIVATE_KEY)
  })

  it('switches only the host it was asked about', async () => {
    const booted = await boot()
    await booted.ctx.sciRemoteHosts.upsert(GPU)
    await booted.ctx.sciRemoteHosts.upsert({ ...GPU, alias: 'box', hostName: '10.1.2.3', user: 'root' })

    const result = await booted.ctx.sciRemoteHosts.toggle({ alias: 'gpu-lab', enabled: false })

    expect(result.ok && result.value.hosts.map(host => [host.alias, host.enabled]))
      .toEqual([['box', true], ['gpu-lab', false]])
  })

  it('switches a host back on without asking for its key again', async () => {
    const booted = await boot()
    await booted.ctx.sciRemoteHosts.upsert(GPU)
    await booted.ctx.sciRemoteHosts.toggle({ alias: 'gpu-lab', enabled: false })

    const result = await booted.ctx.sciRemoteHosts.toggle({ alias: 'gpu-lab', enabled: true })

    expect(result.ok && result.value.hosts[0]?.enabled).toBe(true)
    expect(await readConfig(booted)).toContain('\nHost gpu-lab\n')
  })

  it('removes the entry, empties the key file, and drops the credential record', async () => {
    const booted = await boot(OUTSIDE)
    await booted.ctx.sciRemoteHosts.upsert(GPU)

    const result = await booted.ctx.sciRemoteHosts.remove({ alias: 'gpu-lab' })

    expect(result).toEqual({ ok: true, value: { hosts: [] } })
    await expect(readFile(join(booted.identityDir, 'sci-gpu-lab'), 'utf8')).resolves.toBe('')
    await expect(booted.ctx.credentials.readRecord(credentialKey(CREDENTIAL_SCOPE, 'gpu-lab'))).resolves.toBeUndefined()
    expect((await readConfig(booted)).startsWith(OUTSIDE)).toBe(true)
  })

  it.each([
    { label: 'remove', call: (ctx: Context) => ctx.sciRemoteHosts.remove({ alias: 'absent' }) },
    { label: 'toggle', call: (ctx: Context) => ctx.sciRemoteHosts.toggle({ alias: 'absent', enabled: false }) },
  ])('refuses $label for an alias the block does not hold', async ({ call }) => {
    const booted = await boot()
    await booted.ctx.sciRemoteHosts.upsert(GPU)

    const result = await call(booted.ctx)

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('unknown-alias')
    expect(!result.ok && result.error.alias).toBe('absent')
    expect(!result.ok && result.error.detail).toContain('"absent"')
  })

  it.each([
    { label: 'an alias outside the credential key grammar', request: { ...GPU, alias: 'GPU Lab' }, code: 'invalid-alias' },
    { label: 'an alias starting with a digit', request: { ...GPU, alias: '1gpu' }, code: 'invalid-alias' },
    { label: 'a hostName carrying a second option line', request: { ...GPU, hostName: 'gpu.example.com\n    ProxyCommand touch /tmp/pwned' }, code: 'invalid-field' },
    { label: 'a user carrying whitespace', request: { ...GPU, user: 'ubuntu root' }, code: 'invalid-field' },
    { label: 'a fractional port', request: { ...GPU, port: 22.5 }, code: 'invalid-field' },
    { label: 'a port above the TCP range', request: { ...GPU, port: 70_000 }, code: 'invalid-field' },
    { label: 'a port below the TCP range', request: { ...GPU, port: 0 }, code: 'invalid-field' },
    { label: 'an empty private key', request: { ...GPU, privateKey: '' }, code: 'invalid-field' },
  ])('refuses $label', async ({ request, code }) => {
    const booted = await boot()

    const result = await booted.ctx.sciRemoteHosts.upsert(request)

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe(code)
    await expect(booted.ctx.sciRemoteHosts.list()).resolves.toEqual({ ok: true, value: { hosts: [] } })
  })

  it('reports a config file whose markers cannot be paired, and writes nothing', async () => {
    const booted = await boot(`${OUTSIDE}${MANAGED_BLOCK_START}\nHost gpu-lab\n`)
    const before = await readConfig(booted)

    const results = [
      await booted.ctx.sciRemoteHosts.list(),
      await booted.ctx.sciRemoteHosts.upsert(GPU),
      await booted.ctx.sciRemoteHosts.remove({ alias: 'gpu-lab' }),
      await booted.ctx.sciRemoteHosts.toggle({ alias: 'gpu-lab', enabled: false }),
    ]

    expect(results.map(result => result.ok || result.error.code)).toEqual(Array.from({ length: 4 }, () => 'malformed-config'))
    await expect(readConfig(booted)).resolves.toBe(before)
  })

  it('removes the service when its fiber is disposed', async () => {
    const booted = await boot()

    expect(booted.ctx.get(SERVICE_KEY)).toBeDefined()
    await booted.ctx.fiber.dispose()

    expect(booted.ctx.get(SERVICE_KEY)).toBeUndefined()
    context = undefined
  })
})
