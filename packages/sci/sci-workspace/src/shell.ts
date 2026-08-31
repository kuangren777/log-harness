/**
 * Static pre-screen for recursive deletes reaching into a bundle.
 *
 * This is token matching plus path resolution, not shell semantics: command
 * substitution, variables, and a `cd` earlier in the same command line are not
 * interpreted, so the screen is bypassable and is deliberately only the outer
 * of two layers. The inner layer is the sandbox itself, where the bundle
 * directories belong to the render user and the agent's shell cannot unlink
 * them at all.
 * @module @deepseek-ai/dsh-sci-workspace/shell
 */

import { RULE_BUNDLE_RECURSIVE_DELETE } from './decide.ts'
import { isOutsideDelegationScope, pathSegments, resolveAgainst, sandboxHomeSegments, segmentsUnder } from './paths.ts'
import type { PathLayout } from './paths.ts'
import type { ShellDenial } from './types.ts'

/** What one screening pass needs to resolve and place an operand. */
export interface ShellScreenConfig {
  /** Absolute working directory relative operands resolve against. */
  readonly cwd: string
  /** Absolute directory holding one subdirectory per project. */
  readonly projectRoot: string
  /** Project-relative directories holding the two bundle kinds. */
  readonly bundleDirs: { readonly papers: string; readonly sciplots: string }
  /** Whether the screen is active at all. */
  readonly denyRecursiveDeleteInBundles: boolean
}

/**
 * Split a command line into per-command token lists.
 *
 * Single quotes, double quotes, and backslash escapes are honored so a quoted
 * path is one operand; `;`, `&`, `|`, parentheses, and newlines end a command,
 * which makes each element of a pipeline or list screenable on its own.
 * @param command - the command line as the tool received it.
 * @returns one token list per command, skipping empty commands.
 */
export function tokenizeCommand(command: string): string[][] {
  const segments: string[][] = []
  let tokens: string[] = []
  let token = ''
  let started = false
  let quote: '\'' | '"' | undefined

  /** Close the token under construction, keeping an explicitly empty one. */
  const endToken = (): void => {
    if (!started) return
    tokens.push(token)
    token = ''
    started = false
  }
  /** Close the command under construction. */
  const endSegment = (): void => {
    endToken()
    if (tokens.length === 0) return
    segments.push(tokens)
    tokens = []
  }

  for (let index = 0; index < command.length; index += 1) {
    const char = command.charAt(index)
    if (quote === '\'') {
      if (char === '\'') quote = undefined
      else token += char
      continue
    }
    if (quote === '"') {
      if (char === '"') quote = undefined
      else if (char === '\\' && index + 1 < command.length) token += command.charAt(index += 1)
      else token += char
      continue
    }
    if (char === '\'' || char === '"') {
      quote = char
      started = true
      continue
    }
    if (char === '\\' && index + 1 < command.length) {
      token += command.charAt(index += 1)
      started = true
      continue
    }
    if (char === '\n' || char === ';' || char === '&' || char === '|' || char === '(' || char === ')') {
      endSegment()
      continue
    }
    if (/\s/.test(char)) {
      endToken()
      continue
    }
    token += char
    started = true
  }
  endSegment()
  return segments
}

/**
 * The last component of a command word, so `/bin/rm` screens as `rm`.
 * @param word - the command word.
 * @returns its last path component.
 */
function commandName(word: string): string {
  return word.replace(/^.*[\\/]/, '')
}

/**
 * Whether a token is an option rather than an operand.
 * @param token - one command-line token.
 * @returns whether it starts with `-` and is not the bare stdin marker.
 */
function isOption(token: string): boolean {
  return token.startsWith('-') && token !== '-'
}

/**
 * Whether the argument list asks for recursion.
 * @param args - tokens after the command word.
 * @returns whether a long or clustered short recursive option is present.
 */
function hasRecursiveOption(args: readonly string[]): boolean {
  return args.some(token => token === '--recursive' || (/^-[A-Za-z]+$/.test(token) && /[rR]/.test(token)))
}

/**
 * The operand list, or the working directory when a command defaults to it.
 * @param operands - operands found on the command line.
 * @returns the operands, or `['.']` when there were none.
 */
function orWorkingDirectory(operands: string[]): string[] {
  return operands.length > 0 ? operands : ['.']
}

/**
 * The paths one command would recursively remove, if it removes anything.
 *
 * An option that takes a separate value (such as `git clean -e <pattern>`)
 * contributes that value as an operand. The screen over-approximates on
 * purpose: a refusal it raises wrongly costs one rephrased command, while a
 * miss costs an unrecoverable bundle.
 * @param tokens - one command's tokens, command word first.
 * @returns the operand paths, or `undefined` when the command is not a recursive delete.
 */
export function recursiveDeleteOperands(tokens: readonly string[]): string[] | undefined {
  const [word, ...args] = tokens
  if (word === undefined) return undefined
  const name = commandName(word)
  if (name === 'rm') {
    return hasRecursiveOption(args) ? args.filter(token => !isOption(token)) : undefined
  }
  if (name === 'git' && args[0] === 'clean') {
    return orWorkingDirectory(args.slice(1).filter(token => !isOption(token)))
  }
  if (name === 'find' && args.includes('-delete')) {
    const roots: string[] = []
    for (const token of args) {
      if (isOption(token)) break
      roots.push(token)
    }
    return orWorkingDirectory(roots)
  }
  return undefined
}

/**
 * Whether a resolved path is the bundle group directory of some project, or
 * anything below it.
 * @param path - an already-resolved absolute path.
 * @param projectRootSegments - resolved segments of the project root.
 * @param bundleDirs - the two bundle group directory names.
 * @returns whether the path sits in a bundle region.
 */
function isInBundleRegion(
  path: string,
  projectRootSegments: readonly string[],
  bundleDirs: { readonly papers: string; readonly sciplots: string },
): boolean {
  const rel = segmentsUnder(projectRootSegments, pathSegments(path))
  if (rel === undefined || rel.length < 2) return false
  return rel[1] === bundleDirs.papers || rel[1] === bundleDirs.sciplots
}

/**
 * Screen one shell command for a recursive delete inside a bundle.
 * @param command - the command line the tool call carries.
 * @param config - the working directory, project layout, and the screen's switch.
 * @returns the refusal naming the first offending resolved path, or `undefined` to let the command run.
 */
export function screenShellCommand(command: string, config: ShellScreenConfig): ShellDenial | undefined {
  if (!config.denyRecursiveDeleteInBundles) return undefined
  const projectRootSegments = pathSegments(config.projectRoot)
  for (const tokens of tokenizeCommand(command)) {
    const operands = recursiveDeleteOperands(tokens)
    if (operands === undefined) continue
    for (const operand of operands) {
      const path = resolveAgainst(config.cwd, operand)
      if (!isInBundleRegion(path, projectRootSegments, config.bundleDirs)) continue
      return {
        path,
        rule: RULE_BUNDLE_RECURSIVE_DELETE,
        reason: `refusing a recursive delete of "${path}": papers/ and sciplots/ bundles are append-only version stores owned by the render user, so remove intermediate files under tmp/ instead or ask the user to drop the bundle.`,
      }
    }
  }
  return undefined
}

/**
 * Whether a token can name a location: it has a path separator, walks up a
 * directory, or starts at the home directory. Bare words are left alone — a
 * command's own arguments and flags outnumber its paths.
 * @param token - one command-line token.
 * @returns whether the token is read as a path operand.
 */
function looksLikePath(token: string): boolean {
  return token.includes('/') || token === '..' || token === '~'
}

/**
 * Expand a leading `~` to the sandbox home, which is where the shell would
 * take it; every other token is returned unchanged.
 * @param token - one command-line token.
 * @param layout - the configured region layout.
 * @returns the token with the home directory spelled out.
 */
function expandHome(token: string, layout: PathLayout): string {
  if (token !== '~' && !token.startsWith('~/')) return token
  return `/${sandboxHomeSegments(layout).join('/')}${token.slice(1)}`
}

/**
 * The first path operand of a command line that a delegated agent may not reach.
 *
 * Every non-option token of every command in the line is read as a possible
 * path, resolved against the working directory, and tested with
 * {@link isOutsideDelegationScope}. The screen over-approximates on purpose,
 * as the recursive-delete screen does: a wrongly refused command costs one
 * rephrasing, while a missed one lets a delegation read a sibling project.
 * @param command - the command line the tool call carries.
 * @param cwd - the delegated session's working directory, which is its project.
 * @param layout - the configured region layout.
 * @returns the first resolved path outside the delegation's scope, or `undefined` when every operand is in scope.
 */
export function delegationScopeOperand(command: string, cwd: string, layout: PathLayout): string | undefined {
  for (const tokens of tokenizeCommand(command)) {
    for (const token of tokens.slice(1)) {
      if (isOption(token) || !looksLikePath(token)) continue
      const path = resolveAgainst(cwd, expandHome(token, layout))
      if (isOutsideDelegationScope(path, cwd, layout)) return path
    }
  }
  return undefined
}
