/**
 * Registration of the user's own remote machines for the science-research agent
 * profile: four Typert Remote endpoints that own one managed block of the
 * sandbox's `~/.ssh/config`, and the custody of the private keys those entries
 * point at.
 *
 * This replaces the studied platform's *Agent dialog → SSH* form and the
 * `clawsgo-remote-hosts` skill it fed
 * (`ClawsGO-System/01-Skills/_raw-skills/clawsgo-remote-hosts/SKILL.md`). Two
 * things changed. The platform normalised the whole file on every save, so a
 * user's own `ProxyJump` chain survived only by being kept out of the file's
 * managed region; here the guarantee runs both ways, and everything outside the
 * markers is carried over byte for byte. And the key material now goes through
 * `ctx.credentials`, so the record of what a session was authorized to reach is
 * held by the credential seam instead of existing only as a file nothing owns.
 *
 * No session event is appended. Registering a machine is a configuration act
 * with no session and no Agent behind it: the RPC is called from a settings
 * surface, nothing it writes reaches a model request, and an event would have
 * no session to belong to.
 * @module @deepseek-ai/dsh-sci-remote-hosts
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { isAbsolutePath } from '@deepseek-ai/dsh-sci-workspace'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: merges the services this plugin injects onto Context.
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-fs'
import {
  MANAGED_BLOCK_END,
  MANAGED_BLOCK_START,
  identityFilePath,
  managedBlockFault,
  parseManagedBlock,
  renderManagedBlock,
  spliceManagedBlock,
} from './block.ts'
import type {
  HostsFailure,
  HostsListValue,
  HostsResult,
  ManagedBlockOptions,
  RemoteHost,
  RemoveHostRequest,
  ToggleHostRequest,
  UpsertHostRequest,
} from './types.ts'

export type * from './types.ts'
export {
  MANAGED_BLOCK_END,
  MANAGED_BLOCK_START,
  ManagedBlockError,
  identityFilePath,
  managedBlockFault,
  parseManagedBlock,
  renderManagedBlock,
  spliceManagedBlock,
} from './block.ts'
export { SSH_FAILURE_REMEDIES, classifySshFailure } from './doctor.ts'

/** Cordis service key and Remote binding key of this package. */
export const SERVICE_KEY = 'sciRemoteHosts'

/** Wire namespace the four host endpoints are exported under. */
export const HOSTS_NAMESPACE = 'sci.hosts'

/**
 * Credential-key scope every stored private key is filed under. It is this
 * package's registered name, which is what makes a record left behind by an
 * uninstalled plugin identifiable as an orphan.
 */
export const CREDENTIAL_SCOPE = 'sci-remote-hosts'

/**
 * The alias grammar. It is the credential seam's own key-segment grammar
 * (`credentialKey` rejects anything else), and it is also a bare `ssh <alias>`
 * operand and a file-name suffix, so nothing outside it could be registered
 * without one of the three refusing it later.
 */
const ALIAS_PATTERN = /^[a-z][a-z0-9-]*$/

/** One `HostName` or `User` value: a single token, so no value can inject a second option line. */
const FIELD_PATTERN = /^\S+$/

/** Highest port number a TCP connection can name. */
const MAX_PORT = 65_535

/** The connect timeout the archived skill promises callers, in seconds. */
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10

/**
 * Keep-alive probe interval, in seconds. The archived skill promises
 * keep-alives without naming a period; thirty seconds is the interval published
 * for holding an idle NAT or firewall mapping open, which is the case a lab
 * machine behind a port forward is in.
 */
const DEFAULT_SERVER_ALIVE_INTERVAL_SECONDS = 30

/** Deployment-varying choices of the remote-host layer. */
export interface Config {
  /**
   * Absolute path of the ssh client configuration inside the sandbox. Required:
   * the home directory differs per sandbox image, and a wrong guess would write
   * a block no ssh invocation ever reads.
   */
  sshConfigPath: string
  /**
   * Absolute directory the per-alias private keys are written to. Required for
   * the same reason, and separate from {@link sshConfigPath} because an image
   * may hold keys on a mount with different permissions.
   */
  identityDir: string
  /** Seconds ssh waits for the TCP connection; the archived skill's value is 10. */
  connectTimeoutSeconds: number
  /** Seconds between keep-alive probes on an established connection. */
  serverAliveIntervalSeconds: number
}

/** Schemastery schema for the remote-host layer. */
export const Config: z<Config> = z.object({
  sshConfigPath: z.string().required(),
  identityDir: z.string().required(),
  connectTimeoutSeconds: z.number().step(1).min(1).default(DEFAULT_CONNECT_TIMEOUT_SECONDS),
  serverAliveIntervalSeconds: z.number().step(1).min(1).default(DEFAULT_SERVER_ALIVE_INTERVAL_SECONDS),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    sciRemoteHosts: SciRemoteHostsService
  }
}

/**
 * Reject one host registration whose values could not be written as an ssh
 * entry. This is a wire boundary: `hostName` and `user` are checked to be
 * single tokens because a value carrying a newline would otherwise write extra
 * option lines into the managed block, and the block is read back as the truth
 * about what the model may connect to.
 * @param request - the registration as it arrived.
 * @returns the refusal, or `undefined` when every value is writable.
 */
export function validateUpsert(request: UpsertHostRequest): HostsFailure | undefined {
  if (!ALIAS_PATTERN.test(request.alias)) {
    return {
      code: 'invalid-alias',
      alias: request.alias,
      detail: 'an alias must start with a lowercase letter and hold only lowercase letters, digits, and hyphens',
    }
  }
  for (const [field, value] of [['hostName', request.hostName], ['user', request.user]] as const) {
    if (!FIELD_PATTERN.test(value)) {
      return { code: 'invalid-field', alias: request.alias, detail: `${field} must be one token carrying no whitespace` }
    }
  }
  if (request.port !== undefined && (!Number.isInteger(request.port) || request.port < 1 || request.port > MAX_PORT)) {
    return { code: 'invalid-field', alias: request.alias, detail: `port must be a whole number between 1 and ${MAX_PORT}` }
  }
  if (request.privateKey === '') {
    return { code: 'invalid-field', alias: request.alias, detail: 'privateKey must carry the key material this host authenticates with' }
  }
  return undefined
}

/**
 * Host registration, key custody, and the managed `~/.ssh/config` block.
 *
 * The service never reads a private key back out for a caller: `list` reports
 * only the path of the key an entry uses, so no endpoint of this package can
 * return key material to whoever asks.
 */
export class SciRemoteHostsService extends TypertRemoteService {
  static inject = ['credentials', 'fs']

  /** Loader validation for the remote-host layer's deployment policy. */
  static Config: z<Config> = Config

  private readonly sshConfigPath: string
  private readonly options: ManagedBlockOptions

  /**
   * @param ctx - Host context carrying the credential seam and the sandbox filesystem.
   * @param config - the resolved deployment configuration.
   * @throws Error when either configured path is relative, which would place the block and the keys outside the sandbox home.
   */
  constructor(ctx: Context, config: Config) {
    // The Typert host analyzer reads the service key and namespace off this
    // call site, so both must be the literals themselves; SERVICE_KEY and
    // HOSTS_NAMESPACE re-export the same strings for consumers.
    super(ctx, 'sciRemoteHosts', { namespace: 'sci.hosts' })
    for (const [field, value] of [['sshConfigPath', config.sshConfigPath], ['identityDir', config.identityDir]] as const) {
      if (!isAbsolutePath(value)) {
        throw new Error(`sci-remote-hosts: ${field} must be an absolute path, got ${JSON.stringify(value)}`)
      }
    }
    this.sshConfigPath = config.sshConfigPath
    this.options = {
      identityDir: config.identityDir.replace(/\/+$/, ''),
      connectTimeoutSeconds: config.connectTimeoutSeconds,
      serverAliveIntervalSeconds: config.serverAliveIntervalSeconds,
    }
  }

  /**
   * List every registered host, switched-off entries included.
   * @returns the roster with each entry's key path, or `malformed-config` when the file's markers cannot be paired.
   */
  @Remote('list')
  async list(): Promise<HostsResult<HostsListValue>> {
    const roster = await this.readRoster()
    if (!roster.ok) return roster
    return {
      ok: true,
      value: {
        hosts: roster.value.hosts.map(host => ({
          ...host,
          identityFile: identityFilePath(host.alias, this.options.identityDir),
        })),
      },
    }
  }

  /**
   * Register one machine, replacing any entry that already carries its alias.
   *
   * The three writes commit in custody order: the credential record, then the
   * key file the entry will point at, then the block entry itself. An
   * interruption therefore leaves at worst a key nothing references, never an
   * entry naming a key that was never written.
   * @param request - the host to register and the private key it authenticates with.
   * @returns the roster as it stands after the write, or the refusal.
   */
  @Remote('upsert')
  async upsert(request: UpsertHostRequest): Promise<HostsResult<HostsListValue>> {
    const invalid = validateUpsert(request)
    if (invalid !== undefined) return { ok: false, error: invalid }
    const roster = await this.readRoster()
    if (!roster.ok) return roster

    const host: RemoteHost = {
      alias: request.alias,
      hostName: request.hostName,
      user: request.user,
      ...request.port === undefined ? {} : { port: request.port },
      enabled: request.enabled ?? true,
    }
    await this.ctx.credentials.modifyRecord(
      credentialKey(CREDENTIAL_SCOPE, request.alias),
      (): Promise<CredentialRecord> => Promise.resolve({ kind: 'grant', payload: { privateKey: request.privateKey } }),
    )
    await this.writeText(identityFilePath(request.alias, this.options.identityDir), request.privateKey)
    return this.commit(roster.value.text, roster.value.hosts.filter(entry => entry.alias !== request.alias).concat(host))
  }

  /**
   * Deregister one machine.
   *
   * The entry goes first, so no live entry ever points at a key that has been
   * emptied. The key file is then overwritten with nothing rather than removed:
   * `ctx.fs` has no unlink verb, and leaving the material readable would keep
   * the machine reachable from a sandbox the user just revoked it from.
   * @param request - the alias to remove.
   * @returns the roster as it stands after the removal, or the refusal.
   */
  @Remote('remove')
  async remove(request: RemoveHostRequest): Promise<HostsResult<HostsListValue>> {
    const roster = await this.readRoster()
    if (!roster.ok) return roster
    if (!roster.value.hosts.some(entry => entry.alias === request.alias)) return unknownAlias(request.alias)

    const result = await this.commit(roster.value.text, roster.value.hosts.filter(entry => entry.alias !== request.alias))
    await this.writeText(identityFilePath(request.alias, this.options.identityDir), '')
    await this.ctx.credentials.deleteRecord(credentialKey(CREDENTIAL_SCOPE, request.alias))
    return result
  }

  /**
   * Switch one registered machine on or off.
   *
   * A switched-off host keeps its entry, commented out, and keeps its key: the
   * archived skill defines a commented entry inside the block as a host the
   * user turned off, and switching it back on must not require the key again.
   * @param request - the alias and the state to leave it in.
   * @returns the roster as it stands after the switch, or the refusal.
   */
  @Remote('toggle')
  async toggle(request: ToggleHostRequest): Promise<HostsResult<HostsListValue>> {
    const roster = await this.readRoster()
    if (!roster.ok) return roster
    if (!roster.value.hosts.some(entry => entry.alias === request.alias)) return unknownAlias(request.alias)
    return this.commit(roster.value.text, roster.value.hosts.map(entry =>
      entry.alias === request.alias ? { ...entry, enabled: request.enabled } : entry))
  }

  /**
   * Render, splice, and write one roster, then report it back.
   * @param existing - the config file as the operation read it.
   * @param hosts - the roster to install.
   * @returns the installed roster with each entry's key path.
   */
  private async commit(existing: string, hosts: readonly RemoteHost[]): Promise<HostsResult<HostsListValue>> {
    await this.writeText(this.sshConfigPath, spliceManagedBlock(existing, renderManagedBlock(hosts, this.options)))
    return this.list()
  }

  /**
   * Read the config file and the roster its managed block holds.
   * @returns the file's text with its parsed roster, or the `malformed-config` refusal.
   */
  private async readRoster(): Promise<HostsResult<{ text: string; hosts: readonly RemoteHost[] }>> {
    const text = await this.readText(this.sshConfigPath)
    const fault = managedBlockFault(text)
    if (fault !== undefined) return { ok: false, error: { code: 'malformed-config', detail: fault } }
    return { ok: true, value: { text, hosts: parseManagedBlock(text) } }
  }

  /**
   * Read one sandbox file, treating an absent one as empty.
   * @param path - absolute path inside the sandbox.
   * @returns the file's text, or `''` when nothing is there.
   */
  private async readText(path: string): Promise<string> {
    const target = await this.ctx.fs.resolve(path)
    return await this.ctx.fs.stat(target) === undefined ? '' : this.ctx.fs.readText(target)
  }

  /**
   * Create or replace one sandbox file.
   * @param path - absolute path inside the sandbox.
   * @param content - the whole new content.
   */
  private async writeText(path: string, content: string): Promise<void> {
    await this.ctx.fs.writeText(await this.ctx.fs.resolve(path), content)
  }
}

/**
 * Refuse an operation naming an alias the block does not hold.
 * @param alias - the alias the caller named.
 * @returns the refusal.
 */
function unknownAlias(alias: string): HostsResult<never> {
  return {
    ok: false,
    error: {
      code: 'unknown-alias',
      alias,
      detail: `no host is registered under ${JSON.stringify(alias)} between ${MANAGED_BLOCK_START} and ${MANAGED_BLOCK_END}`,
    },
  }
}

export default SciRemoteHostsService
