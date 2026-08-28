/**
 * The shell delivery spool: the schema-checked replacement for the studied
 * platform's stdout sentinel.
 *
 * The sentinel's one virtue was that it fitted inside a shell loop — copy a
 * file, deliver it, repeat — and its vices were that it had no schema and
 * failed silently. Here the in-sandbox `sci deliver` command writes one JSON
 * entry into `<spoolDir>/pending/`, this module reads it, and the SAME
 * validation chain the tool uses decides it. `pending/` is the one path under
 * `.sci/` a model can write, so an entry is untrusted input: nothing here
 * treats an entry's own claims as authority.
 *
 * `FileSystem` has neither unlink nor rename, so a settled entry is "moved" by
 * writing it under `<spoolDir>/done/` or `<spoolDir>/failed/` and overwriting
 * the pending copy with the {@link SPOOL_TOMBSTONE}, which a later round reads
 * and skips. A crash between the two writes re-delivers at most one entry; a
 * manifest re-delivery is then refused by the once-per-session rule, and an
 * ordinary file's second delivery is idempotent apart from a second card.
 * @module @deepseek-ai/dsh-sci-deliver/src/spool
 */

import type { DeliveryRequest } from './types.ts'

/** Subdirectory of the spool holding entries not yet decided; the one model-writable path under `.sci/`. */
export const SPOOL_PENDING = 'pending'
/** Subdirectory of the spool holding accepted entries. */
export const SPOOL_DONE = 'done'
/** Subdirectory of the spool holding refused entries and their reasons. */
export const SPOOL_FAILED = 'failed'
/** Content that replaces a settled pending entry, since the filesystem seam cannot remove it. */
export const SPOOL_TOMBSTONE = '{"consumed":true}\n'
/** Extension a spool entry must carry; anything else in `pending/` is ignored. */
export const SPOOL_ENTRY_EXTENSION = '.json'

/** One parsed spool entry. */
export type SpoolEntry =
  /** A well-formed request, still subject to the full validation chain. */
  | { readonly kind: 'request'; readonly request: DeliveryRequest }
  /** A tombstone left by an earlier round; nothing to do. */
  | { readonly kind: 'consumed' }
  /** Unparseable or missing the fields `sci deliver` is contracted to write. */
  | { readonly kind: 'malformed'; readonly reason: string }

/**
 * Whether a value is a usable text field of a spool entry.
 * @param value - the parsed member.
 * @returns whether it is a non-blank string.
 */
function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Parse one spool entry without trusting any of its members.
 * @param text - the entry file's raw content.
 * @returns the request it carries, the tombstone marker, or why it is unusable.
 */
export function parseSpoolEntry(text: string): SpoolEntry {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error: unknown) {
    // JSON.parse throws SyntaxError and nothing else.
    return { kind: 'malformed', reason: `spool entry is not valid JSON: ${(error as SyntaxError).message}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'malformed', reason: 'spool entry is not a JSON object' }
  }
  const entry = parsed as Record<string, unknown>
  if (entry['consumed'] === true) return { kind: 'consumed' }
  if (!isText(entry['path'])) return { kind: 'malformed', reason: 'spool entry has no "path" string' }
  if (!isText(entry['title'])) return { kind: 'malformed', reason: 'spool entry has no "title" string' }
  const description = entry['description']
  if (description !== undefined && !isText(description)) {
    return { kind: 'malformed', reason: 'spool entry "description" is not a non-empty string' }
  }
  return {
    kind: 'request',
    request: {
      path: entry['path'],
      title: entry['title'],
      ...description === undefined ? {} : { description },
    },
  }
}

/** Read and write side of one spool round: the sandbox filesystem, or a test double. */
export interface SpoolFileSystem {
  /**
   * List the regular files directly inside a directory.
   * @param path - absolute path of the directory; an absent directory lists empty.
   * @returns the child file names, in stable order.
   */
  readonly listFiles: (path: string) => Promise<readonly string[]>
  /**
   * Read one file as text.
   * @param path - absolute path in the sandbox.
   * @returns the decoded content.
   */
  readonly readText: (path: string) => Promise<string>
  /**
   * Create or replace one file, creating parent directories.
   * @param path - absolute path in the sandbox.
   * @param content - the full new content.
   */
  readonly writeText: (path: string, content: string) => Promise<void>
}

/** Everything one spool round needs beyond the filesystem. */
export interface SpoolRound {
  /** Absolute path of the spool root holding `pending/`, `done/`, and `failed/`. */
  readonly spoolDir: string
  /** The sandbox filesystem, or a test double. */
  readonly fs: SpoolFileSystem
  /**
   * Validate, snapshot, and log one spool-sourced delivery.
   * @param request - the entry's request, still unvalidated.
   * @returns `undefined` when the delivery was logged, or the refusal reason.
   */
  readonly deliver: (request: DeliveryRequest) => Promise<string | undefined>
  /**
   * Report one refusal for logging and for re-injection into the next prompt.
   * @param path - the path the entry named, or the entry's own path when it named none.
   * @param reason - the refusal reason.
   */
  readonly onFailure: (path: string, reason: string) => void
}

/**
 * Decide every pending spool entry once, oldest name first.
 * @param round - the spool root, the filesystem, the delivery callback, and the failure sink.
 * @returns fulfillment after every entry is settled and tombstoned.
 */
export async function drainSpool(round: SpoolRound): Promise<void> {
  const pendingDir = `${round.spoolDir}/${SPOOL_PENDING}`
  for (const fileName of await round.fs.listFiles(pendingDir)) {
    if (!fileName.endsWith(SPOOL_ENTRY_EXTENSION)) continue
    const entryPath = `${pendingDir}/${fileName}`
    const text = await round.fs.readText(entryPath)
    const entry = parseSpoolEntry(text)
    if (entry.kind === 'consumed') continue
    const reason = entry.kind === 'malformed' ? entry.reason : await round.deliver(entry.request)
    if (reason === undefined) {
      await round.fs.writeText(`${round.spoolDir}/${SPOOL_DONE}/${fileName}`, text)
    } else {
      const path = entry.kind === 'malformed' ? entryPath : entry.request.path
      await round.fs.writeText(
        `${round.spoolDir}/${SPOOL_FAILED}/${fileName}`,
        `${JSON.stringify({ reason, entry: text }, null, 2)}\n`,
      )
      round.onFailure(path, reason)
    }
    await round.fs.writeText(entryPath, SPOOL_TOMBSTONE)
  }
}
