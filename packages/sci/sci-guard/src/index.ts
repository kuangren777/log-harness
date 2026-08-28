/**
 * Irreversible-action gate for the science-research agent profile.
 *
 * `apply` owns two contributions, both effects of the mounting fiber:
 *
 * - The *Irreversible actions* prompt chapter, which tells the model to ask the
 *   user before it runs an unsigned binary, transmits local content off the
 *   machine, overwrites credentials, or deletes work.
 * - One `tools/pre-execute` listener that statically classifies the command line
 *   of every mounted shell tool and answers `{ kind: 'ask' }` when it falls in
 *   one of those four categories. The tool registry resolves the question
 *   through the `@deepseek-ai/dsh-user-approval` seam: `allowed-once` runs the
 *   call, every other outcome denies it in the registry's own words.
 *
 * The chapter and the gate are deliberately the same package. The chapter is
 * the rule and the listener is what happens when the model does it anyway, and
 * a deployment that carries one without the other either states a rule nothing
 * enforces or asks questions the model was never told to expect.
 *
 * Nothing is remembered between questions. The chapter's last sentence —
 * authorization for one action does not extend to the next — is implemented by
 * having no approval cache at all: the map this plugin keeps holds only the
 * questions currently in flight, and an entry is dropped the moment its tool
 * call produces a result.
 *
 * Named exports (no default) preserve the Loader's `name`/`inject`/`Config`
 * injection metadata for a function plugin.
 * @module @deepseek-ai/dsh-sci-guard
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { CallId } from '@deepseek-ai/dsh-llm'
import { isAbsolutePath, readStringArg, resolveAgainst } from '@deepseek-ai/dsh-sci-workspace'
import type { Session } from '@deepseek-ai/dsh-session'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome, ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
// Type-only: merges the services this plugin injects onto Context, and the
// approval audit events it reads off the session stream.
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import { CHAPTER_IRREVERSIBLE_ACTIONS, IRREVERSIBLE_ACTIONS_ORDER, SECTION_IRREVERSIBLE_ACTIONS } from './chapter.ts'
import { classifyCommand, execCandidates } from './classify.ts'
import { Config } from './config.ts'
import { explainFinding } from './explain.ts'
import type { RiskCategory } from './types.ts'

export {
  CHAPTER_IRREVERSIBLE_ACTIONS,
  IRREVERSIBLE_ACTIONS_ORDER,
  SECTION_IRREVERSIBLE_ACTIONS,
} from './chapter.ts'
export { classifyCommand, effectiveCommandWord, execCandidates, writeTargets } from './classify.ts'
export { DEFAULT_DESTRUCTIVE_ROOTS, DEFAULT_EXEC_ROOTS, DEFAULT_SHELL_TOOLS } from './config.ts'
export type { CategorySwitches } from './config.ts'
export { explainFinding } from './explain.ts'
export type { CommandFinding, CommandProbe, RiskCategory, SciAuthorizedData, ShellToolBinding } from './types.ts'
export { Config }

/** Cordis plugin name. */
export const name = 'sci-guard'

/**
 * The tool registry whose pre-dispatch waterfall carries the gate, the
 * filesystem candidate executables are identified through, and the prompt layer
 * the chapter joins.
 */
export const inject = ['tools', 'fs', 'systemPrompt']

/** Leading bytes of an ELF image. */
const ELF_MAGIC: readonly number[] = [0x7f, 0x45, 0x4c, 0x46]

/** Leading bytes of a script naming its interpreter. */
const SHEBANG_MAGIC: readonly number[] = [0x23, 0x21]

/**
 * Whether a file's leading bytes are exactly one magic number.
 * @param bytes - the bytes read back from the candidate.
 * @param magic - the magic number to compare against.
 * @returns whether every magic byte matches at its position.
 */
function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, index) => bytes[index] === byte)
}

/** One irreversible-action question currently in flight, from `ask` to tool result. */
interface Question {
  /** The session that asked, and that receives the `sci/authorized` record. */
  readonly session: Session
  /** The category the classifier put the command in. */
  readonly category: RiskCategory
  /** The command line exactly as the tool call carried it. */
  readonly command: string
  /** SHA-256 of the candidate executable, for an `execUnsigned` question whose file was readable. */
  readonly sha256?: string
  /** The approval request this question became, once its `approval/asked` is in the log. */
  requestId?: ApprovalRequestId
  /** What the user answered, once its `approval/decided` is in the log. */
  outcome?: ApprovalOutcome
}

/** The filesystem answers one command line's candidate executables produced. */
interface ProbedCandidates {
  /** Resolved paths whose leading bytes are an ELF image. */
  readonly elf: Set<string>
  /** Resolved paths whose leading bytes name an interpreter. */
  readonly shebang: Set<string>
  /** SHA-256 of each candidate the gate could read in full, by resolved path. */
  readonly digests: Map<string, string>
}

/**
 * Register the science-research irreversible-action gate on the mounting context.
 * @param ctx - the mounting context, carrying `tools`, `fs`, and `systemPrompt`.
 * @param config - the resolved deployment configuration.
 * @throws Error when `projectRoot` is relative, which would place every region outside the gate.
 */
export function apply(ctx: Context, config: Config): void {
  if (!isAbsolutePath(config.projectRoot)) {
    throw new Error(`sci-guard: projectRoot must be an absolute path, got ${JSON.stringify(config.projectRoot)}`)
  }
  const commandArgs = new Map(config.shellTools.map(binding => [binding.name, binding.command]))

  ctx.systemPrompt.section({
    name: SECTION_IRREVERSIBLE_ACTIONS,
    order: IRREVERSIBLE_ACTIONS_ORDER,
    text: CHAPTER_IRREVERSIBLE_ACTIONS,
  })

  // The two indexes of the SAME in-flight questions: by the tool call that
  // raised them, and by the approval request they became. Neither outlives the
  // tool call, so an approved command is classified and asked about again the
  // next time the model runs it.
  const inFlight = new Map<CallId, Question>()
  const byRequest = new Map<ApprovalRequestId, Question>()

  /**
   * Await one filesystem answer, treating a failure as no answer.
   * @param operation - the probe in flight.
   * @returns the value, or `undefined` when the probe failed.
   */
  const attempt = <T>(operation: Promise<T>): Promise<T | undefined> => operation.catch(() => undefined)

  /**
   * Identify every file this command line would execute out of an exec root.
   *
   * A candidate the gate cannot resolve, size, or read back contributes no
   * answer at all, which classifies it as an unsigned script and asks. That is
   * the safe direction: the alternative is running a file nothing observed in
   * this session establishes anything about.
   * @param command - the command line as the tool call carries it.
   * @param resolve - places a command-line operand absolutely.
   * @param signal - the pending call's cancellation signal.
   * @returns the identification and hash of every candidate that was readable.
   */
  const probeCandidates = async (
    command: string,
    resolve: (path: string) => string,
    signal: AbortSignal,
  ): Promise<ProbedCandidates> => {
    const elf = new Set<string>()
    const shebang = new Set<string>()
    const digests = new Map<string, string>()
    for (const path of execCandidates(command, resolve, config)) {
      const target = await attempt(ctx.fs.resolve(path, { signal }))
      if (target === undefined) continue
      const info = await attempt(ctx.fs.stat(target, signal))
      const size = info?.type === 'file' ? info.size : undefined
      if (size === undefined || size === 0 || size > config.probeMaxBytes) continue
      const bytes = await attempt(ctx.fs.readBytes(target, signal, size))
      if (bytes === undefined) continue
      if (startsWith(bytes, ELF_MAGIC)) elf.add(path)
      if (startsWith(bytes, SHEBANG_MAGIC)) shebang.add(path)
      digests.set(path, createHash('sha256').update(bytes).digest('hex'))
    }
    return { elf, shebang, digests }
  }

  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const commandArg = commandArgs.get(exec.name)
    if (commandArg === undefined) return next()
    const command = readStringArg(exec.arguments, commandArg)
    if (command === undefined) return next()
    const session = exec.agent?.session
    const cwd = session?.header.cwd ?? config.projectRoot
    const resolve = (path: string): string => resolveAgainst(cwd, path)
    const probed = await probeCandidates(command, resolve, exec.signal)
    const finding = classifyCommand(command, {
      isElf: path => probed.elf.has(path),
      hasShebang: path => probed.shebang.has(path),
      resolve,
    }, config)
    if (finding === undefined) return next()
    // A call with no agent has no session to audit to and no user to route the
    // question to; the registry denies it for that reason, and there is nothing
    // to record.
    if (session !== undefined) {
      const sha256 = finding.category === 'execUnsigned' ? probed.digests.get(finding.subject) : undefined
      inFlight.set(exec.callId, {
        session,
        category: finding.category,
        command,
        ...sha256 === undefined ? {} : { sha256 },
      })
    }
    return { kind: 'ask', reason: explainFinding(finding) }
  })

  // The decision is read off the approval seam's own audit pair rather than
  // taken from the answerer, so `sci/authorized` can only follow a question a
  // user was actually asked — which is the relationship `./invariant` asserts.
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'approval/asked') {
      const callId = event.data.callId
      if (callId === undefined) return
      const question = inFlight.get(callId)
      if (question === undefined) return
      question.requestId = event.data.id
      byRequest.set(event.data.id, question)
      return
    }
    if (event.type !== 'approval/decided') return
    const question = byRequest.get(event.data.id)
    if (question === undefined) return
    question.outcome = event.data.outcome
  })

  // The record is appended here, after the registry has produced the result, so
  // it lands outside the approval seam's own append publication and strictly
  // after the `approval/decided` it derives from.
  ctx.on('tools/result', (exec): undefined => {
    const question = inFlight.get(exec.callId)
    if (question === undefined) return undefined
    inFlight.delete(exec.callId)
    if (question.requestId !== undefined) byRequest.delete(question.requestId)
    // No outcome means no approval service answered at all: the registry denied
    // the call by itself, no user was asked, and there is no authorization
    // decision to record.
    if (question.outcome === undefined) return undefined
    question.session.append('sci/authorized', {
      callId: exec.callId,
      category: question.category,
      command: question.command,
      ...question.sha256 === undefined ? {} : { sha256: question.sha256 },
      decision: question.outcome === 'allowed-once' ? 'approved' : 'denied',
    }, { ignorable: true })
    return undefined
  })
}
