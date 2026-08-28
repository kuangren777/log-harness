/**
 * The managed `~/.ssh/config` block: how one registered host renders, how the
 * block reads back, and how it is spliced into a file the user also writes.
 *
 * Both directions are guaranteed. Nothing outside the two markers is read,
 * rewritten, reordered, or reformatted — the studied platform normalised hand
 * edits away and the archived skill had to teach users to keep their
 * `ProxyJump` chains elsewhere
 * (`ClawsGO-System/01-Skills/_raw-skills/clawsgo-remote-hosts/SKILL.md`,
 * "Editing SSH config"). Inside the markers the block is authoritative: a
 * switched-off host is commented out rather than deleted, which is exactly what
 * the same skill tells the model a commented entry means.
 * @module @deepseek-ai/dsh-sci-remote-hosts/src/block
 */

import type { ManagedBlockOptions, RemoteHost } from './types.ts'

/** First line of the managed region; everything above it belongs to the user. */
export const MANAGED_BLOCK_START = '# >>> sci remote hosts >>>'

/** Last line of the managed region; everything below it belongs to the user. */
export const MANAGED_BLOCK_END = '# <<< sci remote hosts <<<'

/** Indent every option line of an entry carries, matching the archived block. */
const OPTION_INDENT = '    '

/**
 * A config file whose markers cannot be paired.
 *
 * This is not recoverable by guessing: with one marker missing there is no way
 * to tell where the managed region ends, and rewriting anyway would either
 * duplicate the block or swallow every user entry after it.
 */
export class ManagedBlockError extends Error {
  /** Distinguishes this failure from an ordinary filesystem error at a catch site. */
  override readonly name = 'ManagedBlockError'
}

/** One located managed region, in line coordinates of the file it was found in. */
interface LocatedBlock {
  /** Index of the start-marker line. */
  readonly start: number
  /** Index of the end-marker line. */
  readonly end: number
  /** The file's lines, as {@link start} and {@link end} index them. */
  readonly lines: readonly string[]
}

/**
 * Report why one config file's markers cannot be paired.
 *
 * Callers that must answer rather than throw — the RPC endpoints, which turn
 * this into a `malformed-config` refusal — ask this before touching the file.
 * @param existing - the whole config file as it stands.
 * @returns the fault in one sentence, or `undefined` when the markers are consistent.
 */
export function managedBlockFault(existing: string): string | undefined {
  const lines = existing.split('\n')
  const start = lines.indexOf(MANAGED_BLOCK_START)
  const end = lines.indexOf(MANAGED_BLOCK_END, start === -1 ? 0 : start)
  if (start === -1) {
    return end === -1
      ? undefined
      : `sci-remote-hosts: line ${end + 1} carries the managed end marker with no start marker above it`
  }
  return end === -1
    ? `sci-remote-hosts: the managed block opened at line ${start + 1} has no end marker after it`
    : undefined
}

/**
 * Find the managed region of one config file.
 * @param existing - the whole config file as it stands.
 * @returns the located region, or `undefined` when the file carries no marker at all.
 * @throws ManagedBlockError when exactly one of the two markers is present.
 */
function locate(existing: string): LocatedBlock | undefined {
  const fault = managedBlockFault(existing)
  if (fault !== undefined) throw new ManagedBlockError(fault)
  const lines = existing.split('\n')
  const start = lines.indexOf(MANAGED_BLOCK_START)
  if (start === -1) return undefined
  return { start, end: lines.indexOf(MANAGED_BLOCK_END, start), lines }
}

/**
 * The option lines one host contributes, before any switched-off commenting.
 *
 * The option set is the one the archived skill promises callers it can rely on:
 * non-interactive `BatchMode`, no host-key prompt, a ten-second connect
 * timeout, and keep-alives, so the model never adds `-o` overrides of its own.
 * `IdentitiesOnly` is what keeps that promise honest — without it ssh offers
 * every agent identity first and a full `MaxAuthTries` budget can be spent
 * before the entry's own key is tried, which turns a working host into the
 * skill's first ranked failure cause.
 * @param host - the host to render.
 * @param options - the deployment's key directory and timing values.
 * @returns the entry's lines, `Host` first, with no trailing blank line.
 */
function entryLines(host: RemoteHost, options: ManagedBlockOptions): string[] {
  return [
    `Host ${host.alias}`,
    `${OPTION_INDENT}HostName ${host.hostName}`,
    `${OPTION_INDENT}User ${host.user}`,
    ...host.port === undefined ? [] : [`${OPTION_INDENT}Port ${host.port}`],
    `${OPTION_INDENT}IdentityFile ${identityFilePath(host.alias, options.identityDir)}`,
    `${OPTION_INDENT}IdentitiesOnly yes`,
    `${OPTION_INDENT}BatchMode yes`,
    `${OPTION_INDENT}ConnectTimeout ${options.connectTimeoutSeconds}`,
    `${OPTION_INDENT}ServerAliveInterval ${options.serverAliveIntervalSeconds}`,
    `${OPTION_INDENT}StrictHostKeyChecking accept-new`,
  ]
}

/**
 * Absolute path of one alias's private key.
 * @param alias - the registered alias.
 * @param identityDir - the deployment's key directory, without a trailing slash.
 * @returns the path the entry's `IdentityFile` names.
 */
export function identityFilePath(alias: string, identityDir: string): string {
  return `${identityDir}/sci-${alias}`
}

/**
 * Render the whole managed block, markers included.
 *
 * Entries are emitted in alias order so that re-registering an unchanged roster
 * reproduces the same bytes, and a host that is switched off is commented out
 * in place: the archived skill tells the model that a commented entry inside
 * the block is a host the user turned off and must not be used or uncommented.
 * @param hosts - the registered hosts, in any order.
 * @param options - the deployment's key directory and timing values.
 * @returns the block, starting with the start marker and ending with a newline.
 */
export function renderManagedBlock(hosts: readonly RemoteHost[], options: ManagedBlockOptions): string {
  const sorted = [...hosts].sort((left, right) => left.alias < right.alias ? -1 : 1)
  const lines: string[] = [MANAGED_BLOCK_START]
  for (const host of sorted) {
    const entry = entryLines(host, options)
    lines.push(...host.enabled ? entry : entry.map(line => `# ${line}`))
  }
  lines.push(MANAGED_BLOCK_END, '')
  return lines.join('\n')
}

/** One entry being read back, before it is known to be complete. */
interface HostDraft {
  alias: string
  enabled: boolean
  hostName?: string
  user?: string
  port?: number
}

/**
 * Strip a switched-off entry's comment marker.
 * @param line - one raw line from inside the block.
 * @returns the line's content and whether it was commented out.
 */
function uncomment(line: string): { content: string; commented: boolean } {
  const trimmed = line.trim()
  return trimmed.startsWith('#')
    ? { content: trimmed.slice(1).trim(), commented: true }
    : { content: trimmed, commented: false }
}

/**
 * Add one finished draft to the roster when it can actually be connected to.
 *
 * An entry left without a `HostName` or a `User` by a hand edit inside the
 * block is dropped rather than half-reported: `ssh` would refuse it, and
 * surfacing it as a registered host would make the RPC's roster disagree with
 * what the model can reach.
 * @param draft - the entry read so far, or `undefined` before the first `Host` line.
 * @param into - the roster being built.
 */
function commit(draft: HostDraft | undefined, into: RemoteHost[]): void {
  if (draft?.hostName === undefined || draft.user === undefined) return
  into.push({
    alias: draft.alias,
    hostName: draft.hostName,
    user: draft.user,
    ...draft.port === undefined ? {} : { port: draft.port },
    enabled: draft.enabled,
  })
}

/**
 * Read the registered hosts back out of a config file.
 *
 * Only the managed region is read: a `Host` entry the user keeps outside the
 * markers is theirs, and reporting it as registered would offer the model a
 * host this package cannot re-render or switch off.
 * @param existing - the whole config file, or a bare rendered block.
 * @returns the hosts the block holds, in the order it stores them; empty when there is no block.
 * @throws ManagedBlockError when exactly one of the two markers is present.
 */
export function parseManagedBlock(existing: string): RemoteHost[] {
  const located = locate(existing)
  if (located === undefined) return []
  const hosts: RemoteHost[] = []
  let draft: HostDraft | undefined
  for (const line of located.lines.slice(located.start + 1, located.end)) {
    const { content, commented } = uncomment(line)
    const separator = content.search(/\s/)
    if (separator === -1) continue
    const keyword = content.slice(0, separator)
    const value = content.slice(separator + 1).trim()
    if (keyword === 'Host') {
      commit(draft, hosts)
      draft = { alias: value, enabled: !commented }
    } else if (draft === undefined) continue
    else if (keyword === 'HostName') draft.hostName = value
    else if (keyword === 'User') draft.user = value
    else if (keyword === 'Port' && Number.isInteger(Number(value))) draft.port = Number(value)
  }
  commit(draft, hosts)
  return hosts
}

/**
 * Replace the managed block of one config file, or append it when there is none.
 *
 * Every byte before the start marker and after the end marker is carried over
 * unchanged. The one exception is a file whose last line has no newline: the
 * block is appended after closing that line, because otherwise the user's last
 * entry and the start marker would become one line.
 * @param existing - the whole config file as it stands; empty when the file does not exist yet.
 * @param block - the block to install, as {@link renderManagedBlock} produced it.
 * @returns the file's new content.
 * @throws ManagedBlockError when exactly one of the two markers is present.
 */
export function spliceManagedBlock(existing: string, block: string): string {
  const located = locate(existing)
  if (located === undefined) {
    if (existing === '') return block
    return existing.endsWith('\n') ? existing + block : `${existing}\n${block}`
  }
  const before = located.lines.slice(0, located.start)
  const prefix = before.length === 0 ? '' : `${before.join('\n')}\n`
  return prefix + block + located.lines.slice(located.end + 1).join('\n')
}
