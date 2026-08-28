/**
 * Static classification of one shell command line into an irreversible-action
 * category.
 *
 * This is token matching plus path placement, not shell semantics: command
 * substitution, variables, functions, and an earlier `cd` in the same command
 * line are not interpreted, so the classifier is bypassable and is deliberately
 * only the outer of two layers. The inner one is the sandbox image, where the
 * bundle directories belong to the render user and the sandbox network policy
 * decides what an egress attempt can reach at all.
 *
 * The command line is split by `tokenizeCommand` from
 * `@deepseek-ai/dsh-sci-workspace`, whose quoting and command-separator rules
 * both gates share, and a recursive delete is recognized by that package's
 * `recursiveDeleteOperands`, so a command the workspace gate refuses inside a
 * bundle is the same command this gate asks about elsewhere.
 * @module @deepseek-ai/dsh-sci-guard/classify
 */

import { pathSegments, recursiveDeleteOperands, segmentsUnder, tokenizeCommand } from '@deepseek-ai/dsh-sci-workspace'
import type { Config } from './config.ts'
import type { CommandFinding, CommandProbe } from './types.ts'

/** The last component of a command word, so `/usr/bin/curl` classifies as `curl`. */
function commandName(word: string): string {
  return word.replace(/^.*[\\/]/, '')
}

/**
 * The name of the command one tokenized segment runs.
 * @param tokens - one command's tokens, command word first.
 * @returns the last component of the command word.
 */
function segmentName(tokens: readonly string[]): string {
  /* v8 ignore next -- tokenizeCommand never emits a segment without a command word */
  return commandName(tokens[0] ?? '')
}

/** Whether a token is an option rather than an operand. */
function isOption(token: string): boolean {
  return token.startsWith('-') && token !== '-'
}

/** A leading `VAR=value` environment assignment, which precedes the command word. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * Commands that run another command, so the word after them is the one being
 * executed. Only their operand-free form is unwrapped: an option that takes a
 * separate value (`sudo -u other ./installer`) leaves that value looking like
 * the command word, and the real one is not found.
 */
const COMMAND_PREFIXES = new Set(['sudo', 'env', 'nohup', 'exec', 'command'])

/**
 * The word one command segment executes, looking through environment
 * assignments and command-running prefixes.
 * @param tokens - one command's tokens, command word first.
 * @returns the executed word, or `undefined` when the segment carries only options and assignments.
 */
export function effectiveCommandWord(tokens: readonly string[]): string | undefined {
  for (const token of tokens) {
    if (ASSIGNMENT.test(token)) continue
    if (isOption(token)) continue
    if (COMMAND_PREFIXES.has(commandName(token))) continue
    return token
  }
  return undefined
}

/**
 * Whether a resolved path lies in one of the named project-relative regions.
 * @param path - an already-resolved absolute path.
 * @param projectRootSegments - resolved segments of the project root.
 * @param regions - the project-relative directory names that count.
 * @param minLength - fewest project-relative segments the path must have; `3` demands a path strictly inside the region.
 * @returns whether the path lies in one of the regions.
 */
function isInRegion(
  path: string,
  projectRootSegments: readonly string[],
  regions: readonly string[],
  minLength: number,
): boolean {
  const rel = segmentsUnder(projectRootSegments, pathSegments(path))
  if (rel === undefined || rel.length < minLength) return false
  return regions.includes(rel[1] as string)
}

/**
 * The resolved paths a tokenized command line would execute out of an exec root.
 * @param segments - the tokenized command line.
 * @param resolve - places a command-line operand absolutely.
 * @param config - the resolved deployment configuration.
 * @returns the resolved candidate paths, in first-appearance order.
 */
function execCandidatesOf(
  segments: readonly (readonly string[])[],
  resolve: (path: string) => string,
  config: Config,
): string[] {
  const projectRootSegments = pathSegments(config.projectRoot)
  const candidates: string[] = []
  for (const tokens of segments) {
    const word = effectiveCommandWord(tokens)
    if (word === undefined || !word.includes('/')) continue
    const path = resolve(word)
    if (!isInRegion(path, projectRootSegments, config.execRoots, 3)) continue
    if (!candidates.includes(path)) candidates.push(path)
  }
  return candidates
}

/**
 * The resolved paths this command line would execute out of an exec root.
 *
 * The plugin calls this before classifying so it can read and hash each
 * candidate through the asynchronous `ctx.fs` seam and hand the answers back
 * as a synchronous {@link CommandProbe}.
 * @param command - the command line as the tool call carries it.
 * @param resolve - places a command-line operand absolutely.
 * @param config - the resolved deployment configuration.
 * @returns the resolved candidate paths, empty when the `execUnsigned` category is switched off.
 */
export function execCandidates(command: string, resolve: (path: string) => string, config: Config): string[] {
  if (!config.categories.execUnsigned) return []
  return execCandidatesOf(tokenizeCommand(command), resolve, config)
}

/**
 * Whether a `chmod` mode argument grants execute permission.
 * @param mode - the mode operand as written.
 * @returns whether a symbolic `x` or an odd-numbered octal digit is present.
 */
function isExecutableMode(mode: string): boolean {
  if (/^[0-7]+$/.test(mode)) return /[1357]/.test(mode)
  return mode.includes('x')
}

/**
 * The resolved paths this command line marks executable.
 * @param segments - the tokenized command line.
 * @param resolve - places a command-line operand absolutely.
 * @returns every resolved `chmod` target that gains execute permission.
 */
function chmodExecTargets(segments: readonly (readonly string[])[], resolve: (path: string) => string): Set<string> {
  const targets = new Set<string>()
  for (const tokens of segments) {
    if (segmentName(tokens) !== 'chmod') continue
    const operands = tokens.slice(1).filter(token => !isOption(token))
    const [mode, ...rest] = operands
    if (mode === undefined || !isExecutableMode(mode)) continue
    for (const target of rest) targets.add(resolve(target))
  }
  return targets
}

/**
 * The unsigned executable this command line runs, if any.
 * @param segments - the tokenized command line.
 * @param io - the resolved filesystem answers.
 * @param config - the resolved deployment configuration.
 * @returns the resolved path that needs a decision, or `undefined`.
 */
function execUnsignedSubject(
  segments: readonly (readonly string[])[],
  io: CommandProbe,
  config: Config,
): string | undefined {
  const candidates = execCandidatesOf(segments, io.resolve, config)
  const marked = chmodExecTargets(segments, io.resolve)
  for (const candidate of candidates) {
    if (marked.has(candidate)) return candidate
    if (io.isElf(candidate)) return candidate
    if (!io.hasShebang(candidate)) return candidate
  }
  return undefined
}

/** Split `--flag=value` and `-fvalue` into the flag and its attached value. */
function splitFlagValue(token: string): { flag: string; attached?: string } {
  if (token.startsWith('--')) {
    const equals = token.indexOf('=')
    return equals < 0 ? { flag: token } : { flag: token.slice(0, equals), attached: token.slice(equals + 1) }
  }
  if (token.startsWith('-') && token.length > 2) return { flag: token.slice(0, 2), attached: token.slice(2) }
  return { flag: token }
}

/** `curl` flags whose value is a local file sent as the request body. */
const CURL_UPLOAD_FLAGS = new Set(['-T', '--upload-file'])

/** `curl` flags whose value uploads a local file when it is `@`-prefixed. */
const CURL_AT_FLAGS = new Set(['-d', '--data', '--data-binary', '-F', '--form'])

/**
 * The local content one `curl` invocation uploads, if any.
 * @param args - the tokens after the `curl` word.
 * @returns the operand naming the uploaded content, or `undefined` for a download or plain request.
 */
function curlUploadOperand(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const { flag, attached } = splitFlagValue(args[index] as string)
    const value = attached ?? args[index + 1]
    if (value === undefined) continue
    if (CURL_UPLOAD_FLAGS.has(flag)) return value
    if (CURL_AT_FLAGS.has(flag) && (value.startsWith('@') || value.includes('=@'))) return value
  }
  return undefined
}

/** A `[user@]host:path` operand, which `scp` and `rsync` treat as the remote side. */
const REMOTE_OPERAND = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(@[A-Za-z0-9_.-]+)?:/

/** A `socat` address that opens an outbound connection. */
const SOCAT_CONNECT = /^(TCP|UDP|OPENSSL|SOCKS4|SOCKS4A|PROXY)[46]?(-CONNECT)?:/i

/** Options that turn `nc` into a listener rather than an outbound client. */
function isListenOption(token: string): boolean {
  return token === '--listen' || (/^-[A-Za-z]+$/.test(token) && token.includes('l'))
}

/**
 * The destination one command line sends local content to, if any.
 * @param tokens - one command's tokens, command word first.
 * @returns the operand naming the outbound destination or the uploaded content, or `undefined`.
 */
function egressOperand(tokens: readonly string[]): string | undefined {
  const name = segmentName(tokens)
  const args = tokens.slice(1)
  if (name === 'curl') return curlUploadOperand(args)
  if (name === 'scp' || name === 'rsync') {
    const destination = args.filter(token => !isOption(token)).at(-1)
    return destination !== undefined && REMOTE_OPERAND.test(destination) ? destination : undefined
  }
  if (name === 'nc' || name === 'ncat') {
    if (args.some(isListenOption)) return undefined
    return args.find(token => !isOption(token))
  }
  if (name === 'socat') return args.find(token => SOCAT_CONNECT.test(token))
  return undefined
}

/** Path components of an operand as written, without resolving it. */
function operandComponents(operand: string): string[] {
  return operand.split(/[\\/]/)
}

/**
 * Whether an operand names SSH key material, a `.netrc`, or a private key
 * file. The test is textual on the operand as written, because the paths that
 * matter are `~`-relative and the shell, not this gate, expands `~`.
 * @param operand - a write destination as it appeared on the command line.
 * @returns whether writing it destroys credentials.
 */
function isCredentialOperand(operand: string): boolean {
  const components = operandComponents(operand)
  const base = (components.at(-1) as string).toLowerCase()
  if (components.slice(0, -1).includes('.ssh')) return true
  return base === '.netrc' || base.endsWith('.pem') || base.endsWith('.key')
}

/** A redirection token: an optional file descriptor, `>` or `>>`, and any attached target. */
const REDIRECTION = /^(\d*)(>>?)(.*)$/

/** Commands whose last operand is the destination they write. */
const COPY_COMMANDS = new Set(['cp', 'mv', 'install'])

/**
 * Every path one command segment writes: redirection targets, the destination
 * of a copy or move, and each file `tee` opens.
 * @param tokens - one command's tokens, command word first.
 * @returns the write destinations as written.
 */
export function writeTargets(tokens: readonly string[]): string[] {
  const targets: string[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const match = REDIRECTION.exec(tokens[index] as string)
    if (match === null) continue
    const attached = match[3] as string
    const target = attached.length > 0 ? attached : tokens[index + 1]
    if (target !== undefined && !target.startsWith('&')) targets.push(target)
  }
  const name = segmentName(tokens)
  const operands = tokens.slice(1).filter(token => !isOption(token) && REDIRECTION.exec(token) === null)
  if (name === 'tee') return [...targets, ...operands]
  if (COPY_COMMANDS.has(name) && operands.length >= 2) targets.push(operands.at(-1) as string)
  return targets
}

/**
 * Classify one shell command line.
 *
 * The four categories are tested in the order they appear in the security
 * model — unsigned execution, egress, credential writes, destructive deletes —
 * and the first hit wins, so a command that both uploads and deletes is asked
 * about as the upload it is. A category switched off in {@link Config} is
 * skipped entirely rather than reported and ignored.
 * @param command - the command line exactly as the tool call carries it.
 * @param io - synchronous answers about candidate files, and operand placement.
 * @param config - the resolved deployment configuration.
 * @returns the category and the token or path it rests on, or `undefined` when nothing needs a decision.
 */
export function classifyCommand(command: string, io: CommandProbe, config: Config): CommandFinding | undefined {
  const segments = tokenizeCommand(command)
  const projectRootSegments = pathSegments(config.projectRoot)

  if (config.categories.execUnsigned) {
    const subject = execUnsignedSubject(segments, io, config)
    if (subject !== undefined) return { category: 'execUnsigned', subject }
  }
  if (config.categories.egress) {
    for (const tokens of segments) {
      const operand = egressOperand(tokens)
      if (operand !== undefined) return { category: 'egress', subject: operand }
    }
  }
  if (config.categories.credential) {
    for (const tokens of segments) {
      const operand = writeTargets(tokens).find(isCredentialOperand)
      if (operand !== undefined) return { category: 'credential', subject: operand }
    }
  }
  if (config.categories.destructive) {
    for (const tokens of segments) {
      for (const operand of recursiveDeleteOperands(tokens) ?? []) {
        const path = io.resolve(operand)
        if (isInRegion(path, projectRootSegments, config.destructiveRoots, 2)) {
          return { category: 'destructive', subject: path }
        }
      }
    }
  }
  return undefined
}
