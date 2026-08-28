/**
 * Vocabulary of the irreversible-action gate: the four risk categories, the
 * synchronous probe the pure classifier reads the filesystem through, and the
 * one session event this package appends.
 * @module @deepseek-ai/dsh-sci-guard/types
 */

import type { CallId } from '@deepseek-ai/dsh-llm'

/**
 * One class of irreversible action, named exactly as the matching
 * {@link Config.categories} switch so a finding indexes its own switch.
 *
 * - `execUnsigned` — running a file the agent itself produced or fetched into
 *   a scratch region, whose behaviour nothing in the session establishes.
 * - `egress` — moving bytes off this machine to an endpoint the user did not
 *   name.
 * - `credential` — writing over SSH keys, `.netrc`, or a private key file.
 * - `destructive` — a recursive delete reaching a region holding work.
 */
export type RiskCategory = 'execUnsigned' | 'egress' | 'credential' | 'destructive'

/**
 * What one classification pass learned about a command line: which category it
 * falls in and the one resolved path or command-line token that put it there.
 */
export interface CommandFinding {
  /** The category the command falls in. */
  readonly category: RiskCategory
  /**
   * The resolved path or literal token the classification rests on — the
   * binary to be executed, the upload operand, the credential file written,
   * or the directory to be removed. It is the "what it touches" sentence of
   * the approval reason and the subject of the `sci/authorized` record.
   */
  readonly subject: string
}

/**
 * The filesystem facts {@link classifyCommand} needs, supplied synchronously so
 * classification stays a pure function of the command line plus these answers.
 *
 * The plugin resolves and reads every candidate before calling the classifier
 * (`ctx.fs` is asynchronous); a test supplies the same answers from a literal
 * table. An unknown answer is `false` for both predicates, which classifies an
 * unprobeable candidate as an unsigned script rather than letting it through.
 */
export interface CommandProbe {
  /**
   * Whether the file at a resolved path begins with the ELF magic number —
   * `true` only when the first four bytes are `\x7fELF`.
   */
  readonly isElf: (path: string) => boolean
  /**
   * Whether the file at a resolved path begins with `#!` — `true` only when the
   * first two bytes name an interpreter.
   */
  readonly hasShebang: (path: string) => boolean
  /**
   * Place a command-line operand absolutely, taking the operand exactly as the
   * command line carries it and returning the normalized absolute path it
   * names. A plain function rather than a method: the classifier passes it on
   * to its own helpers.
   */
  readonly resolve: (path: string) => string
}

/** Where one shell-class tool keeps the command text this gate classifies. */
export interface ShellToolBinding {
  /** Registered tool name, as `ctx.tools` knows it. */
  name: string
  /** Argument holding the command line to classify. */
  command: string
}

/** Payload of {@link SessionEventMap['sci/authorized']}. */
export interface SciAuthorizedData {
  /** The tool call the authorization question was about; pairs this record with its `approval/asked`. */
  readonly callId: CallId
  /** Which class of irreversible action was asked about. */
  readonly category: RiskCategory
  /** The command line exactly as the tool call carried it. */
  readonly command: string
  /**
   * SHA-256 of the candidate binary or script, present only for an
   * `execUnsigned` question whose file the gate could read in full. It is the
   * identity the user was asked to authorize, so a later run of a modified
   * file at the same path is visibly a different question.
   */
  readonly sha256?: string
  /** What the user answered: `approved` only for an `allowed-once` grant. */
  readonly decision: 'approved' | 'denied'
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One irreversible-action question reached a decision: log-only,
     * non-surface, one record per approval this gate asked for. The model
     * already learned the outcome from the tool result or from the call
     * running, and nothing later in the log is interpreted differently by this
     * event's presence — it exists so an audit projection can count
     * authorizations and refusals per session — so the producer appends it
     * with the envelope's `ignorable` marker and a reader that does not know
     * the type skips it instead of refusing the log.
     */
    'sci/authorized': SciAuthorizedData
  }
}
