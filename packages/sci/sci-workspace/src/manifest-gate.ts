/**
 * Ownership and validity gate for bundle manifests.
 *
 * A `.paper`, `.sciplot`, or `.canvas` file is co-edited: the agent owns the
 * descriptive fields while the LaTeX workbench, the render script, and the
 * user's own layout own the rest. The agent never sees the co-editing side, so
 * a change to an owned field is refused rather than merged. Deciding that
 * before dispatch means reconstructing what the call would leave on disk, which
 * is what {@link applyReplacement} and {@link checkManifestChange} do.
 * @module @deepseek-ai/dsh-sci-workspace/manifest-gate
 */

import { diffOwnedFields, validatePaper, validateSciplot } from '@deepseek-ai/dsh-sci-manifest'
import type { ManifestKind, ValidationResult } from '@deepseek-ai/dsh-sci-manifest'
import { RULE_MANIFEST_INVALID, RULE_MANIFEST_OWNED_FIELD, RULE_MANIFEST_UNVERIFIABLE } from './decide.ts'
import type { FsOp } from './types.ts'

/**
 * The validator of each kind that can run without touching the disk.
 *
 * `canvas` is absent: its validator must know whether each node's asset file
 * exists, and a pre-dispatch gate cannot stat every node without turning one
 * write into a directory walk. A canvas still passes the ownership check here,
 * and `deliver_files` validates it in full before it reaches the user.
 */
const VALIDATORS: Partial<Readonly<Record<ManifestKind, (json: unknown) => ValidationResult>>> = {
  paper: validatePaper,
  sciplot: validateSciplot,
}

/** Who owns the fields of each kind that the agent must not write. */
const OWNERS: Readonly<Record<ManifestKind, string>> = {
  paper: 'the LaTeX workbench appends them',
  sciplot: 'the render script and the user maintain them',
  canvas: 'the user\'s own layout sets them',
}

/**
 * Apply a literal replacement the way the edit tools do.
 *
 * A missing match leaves the content untouched: the tool itself rejects that
 * call, so the gate has nothing to decide about it. A single replacement takes
 * the first match, which is the only one the tool accepts anyway.
 * @param before - the current file content.
 * @param oldText - the literal text being replaced.
 * @param newText - the literal replacement.
 * @param replaceAll - whether every occurrence is replaced.
 * @returns the content the edit would leave on disk.
 */
export function applyReplacement(before: string, oldText: string, newText: string, replaceAll: boolean): string {
  if (replaceAll) return before.split(oldText).join(newText)
  const at = before.indexOf(oldText)
  if (at < 0) return before
  return before.slice(0, at) + newText + before.slice(at + oldText.length)
}

/**
 * Parse manifest text without throwing.
 * @param text - the file content, or `undefined` for an absent file.
 * @returns the parsed value, or `undefined` when the text is absent or not JSON.
 */
export function parseManifestJson(text: string | undefined): unknown {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    // Only a SyntaxError can leave JSON.parse for a string input; an
    // unparsable revision reads as absent, which the ownership diff already
    // reports as changing every owned field the other revision has.
    return undefined
  }
}

/** One manifest change the gate has to rule on. */
export interface ManifestChange {
  /** The bundle kind the target path's extension names. */
  readonly kind: ManifestKind
  /** The resolved target path, quoted back in every reason. */
  readonly path: string
  /** The operation producing the change. */
  readonly op: FsOp
  /** The file content on disk, or `undefined` when the manifest does not exist yet. */
  readonly before: string | undefined
  /** The file content the call would leave on disk, or `undefined` when it cannot be reconstructed. */
  readonly after: string | undefined
}

/** A refusal raised by the manifest gate. */
export interface ManifestDenial {
  /** Stable rule id. */
  readonly rule: string
  /** One model-facing sentence stating the refusal and the way forward. */
  readonly reason: string
}

/**
 * Rule on one manifest change.
 *
 * Validity is checked for a write only. A write replaces the whole document, so
 * an invalid result is this call's doing; an edit is a repair of a document the
 * workbench owns, and refusing it for pre-existing defects would trap the agent
 * in a file it cannot fix. Ownership is checked either way, and it is what
 * keeps an edit from smuggling a rewrite past the validator. Ownership does
 * not apply while the manifest does not exist yet: there is no other writer's
 * revision to preserve.
 * @param change - the reconstructed before/after pair and its context.
 * @returns the refusal, or `undefined` when the change is the agent's to make.
 */
export function checkManifestChange(change: ManifestChange): ManifestDenial | undefined {
  const { kind, path, op, before, after } = change
  if (after === undefined) {
    return {
      rule: RULE_MANIFEST_UNVERIFIABLE,
      reason: `refusing to ${op} "${path}": this call does not carry enough information to reconstruct the resulting ${kind} manifest, so the fields it must not touch cannot be checked — rewrite the whole file with the write tool instead.`,
    }
  }
  const parsedAfter = parseManifestJson(after)
  // A manifest that does not exist yet has no co-editing side to protect: the
  // agent creates the platform-owned collections empty and the workbench takes
  // them over from there.
  const changed = before === undefined ? [] : diffOwnedFields(kind, parseManifestJson(before), parsedAfter)
  if (changed.length > 0) {
    return {
      rule: RULE_MANIFEST_OWNED_FIELD,
      reason: `refusing to ${op} "${path}": it changes ${changed.join(', ')} — ${OWNERS[kind]}, and this call cannot see their side of the file. Describe the change in chat instead.`,
    }
  }
  const validate = VALIDATORS[kind]
  if (op !== 'write' || validate === undefined) return undefined
  const result = validate(parsedAfter)
  if (result.ok) return undefined
  return {
    rule: RULE_MANIFEST_INVALID,
    reason: `refusing to write "${path}": the result would not be a valid ${kind} manifest — ${result.errors.slice(0, 3).join('; ')}.`,
  }
}
