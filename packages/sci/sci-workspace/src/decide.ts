/**
 * The workspace contract's path table as data: one decision per
 * (operation, {@link PathClass}) pair, plus the denial-rule vocabulary every
 * `sci/fs-denied` event is drawn from.
 *
 * Read is allowed in every region. The contract restricts what the agent may
 * change, not what it may look at; the only refusal a read can earn is the
 * binary-content one, which depends on the bytes rather than the location.
 * @module @deepseek-ai/dsh-sci-workspace/decide
 */

import type { FsDecision, FsOp, PathClass } from './types.ts'

/** Refusal of an append-only region's overwrite. */
export const RULE_VERSIONS_APPEND_ONLY = 'versions-append-only'
/** Refusal of any tool-level write into a render-owned version store. */
export const RULE_RENDER_OWNED_VERSIONS = 'render-owned-versions'
/** Refusal of a foreign reference document placed among the user's manuscripts. */
export const RULE_REFERENCES_OUTSIDE_PAPERS = 'references-outside-papers'
/** Refusal of a change to the harness-synchronized skill tree. */
export const RULE_SKILLS_READ_ONLY = 'skills-read-only'
/** Refusal of a change to a delivery request already queued in the spool. */
export const RULE_SPOOL_CREATE_ONLY = 'spool-create-only'
/** Refusal of a change to harness-private state. */
export const RULE_SCI_PRIVATE = 'sci-private'
/** Refusal of a read whose first bytes identify a non-text file. */
export const RULE_BINARY_READ = 'binary-read'
/** Refusal of a recursive delete reaching into a bundle. */
export const RULE_BUNDLE_RECURSIVE_DELETE = 'bundle-recursive-delete'
/** Refusal of a manifest change touching a field the agent does not own. */
export const RULE_MANIFEST_OWNED_FIELD = 'manifest-owned-field'
/** Refusal of a manifest write that would leave the manifest invalid. */
export const RULE_MANIFEST_INVALID = 'manifest-invalid'
/** Refusal of a manifest change whose result the gate cannot reconstruct. */
export const RULE_MANIFEST_UNVERIFIABLE = 'manifest-unverifiable'
/** Refusal of a delegated agent reaching outside the project it was delegated into. */
export const RULE_DELEGATION_SCOPE = 'delegation-scope'

/**
 * Every rule id this package can attribute a refusal to. The `sci/fs-denied`
 * stream is validated against this set, so an audit projection bucketing by
 * rule never meets an unknown one.
 */
export const FS_DENIAL_RULES: ReadonlySet<string> = new Set([
  RULE_VERSIONS_APPEND_ONLY,
  RULE_RENDER_OWNED_VERSIONS,
  RULE_REFERENCES_OUTSIDE_PAPERS,
  RULE_SKILLS_READ_ONLY,
  RULE_SPOOL_CREATE_ONLY,
  RULE_SCI_PRIVATE,
  RULE_BINARY_READ,
  RULE_BUNDLE_RECURSIVE_DELETE,
  RULE_MANIFEST_OWNED_FIELD,
  RULE_MANIFEST_INVALID,
  RULE_MANIFEST_UNVERIFIABLE,
  RULE_DELEGATION_SCOPE,
])

const ALLOW: FsDecision = { kind: 'allow' }
const CREATE_ONLY: FsDecision = { kind: 'allow-if-absent' }

/**
 * Build one refusal of the path table.
 * @param rule - the stable rule id.
 * @param reason - the model-facing sentence.
 * @returns the denial decision.
 */
function deny(rule: string, reason: string): FsDecision {
  return { kind: 'deny', rule, reason }
}

const DENY_PAPER_VERSIONS = deny(
  RULE_VERSIONS_APPEND_ONLY,
  'papers/<slug>/versions/ is append-only and belongs to the LaTeX workbench: edit the sources under src/ and compile a new version instead of changing an archived one.',
)
const DENY_SCIPLOT_VERSIONS = deny(
  RULE_RENDER_OWNED_VERSIONS,
  'sciplots/<slug>/versions/ is written only by the render wrapper: edit the script under code/ and re-render instead of writing the output yourself.',
)
const DENY_REFERENCES = deny(
  RULE_REFERENCES_OUTSIDE_PAPERS,
  'papers/ holds only manuscripts written for the user: keep a reference PDF under tmp/refs/ and cite it from there.',
)
const DENY_SKILLS = deny(
  RULE_SKILLS_READ_ONLY,
  'skills/ is synchronized by the harness and is read-only inside the sandbox: describe the skill change you want in chat.',
)
const DENY_SPOOL_EDIT = deny(
  RULE_SPOOL_CREATE_ONLY,
  'a queued delivery request is immutable once written: write a new request file instead of changing one already in the spool.',
)
const DENY_PRIVATE = deny(
  RULE_SCI_PRIVATE,
  'this path belongs to the harness, not to the session: the spool directory for new delivery requests is the only part of it you can write.',
)

/**
 * The workspace contract's path table, one row per class. Every cell is a fixed
 * decision, so the table is data rather than control flow and reads next to the
 * contract document it encodes.
 */
const FS_DECISIONS: Readonly<Record<PathClass, Readonly<Record<FsOp, FsDecision>>>> = {
  'workspace': { read: ALLOW, write: ALLOW, edit: ALLOW },
  'tmp': { read: ALLOW, write: ALLOW, edit: ALLOW },
  'paper-src': { read: ALLOW, write: ALLOW, edit: ALLOW },
  'paper-manifest': { read: ALLOW, write: ALLOW, edit: ALLOW },
  'paper-versions': { read: ALLOW, write: CREATE_ONLY, edit: DENY_PAPER_VERSIONS },
  'sciplot-code': { read: ALLOW, write: ALLOW, edit: ALLOW },
  'sciplot-manifest': { read: ALLOW, write: ALLOW, edit: ALLOW },
  'sciplot-versions': { read: ALLOW, write: DENY_SCIPLOT_VERSIONS, edit: DENY_SCIPLOT_VERSIONS },
  'references': { read: ALLOW, write: DENY_REFERENCES, edit: DENY_REFERENCES },
  'skills': { read: ALLOW, write: DENY_SKILLS, edit: DENY_SKILLS },
  'spool-pending': { read: ALLOW, write: CREATE_ONLY, edit: DENY_SPOOL_EDIT },
  'private': { read: ALLOW, write: DENY_PRIVATE, edit: DENY_PRIVATE },
  'other': { read: ALLOW, write: ALLOW, edit: ALLOW },
}

/**
 * Decide one filesystem operation against the path table.
 *
 * The two manifest classes read as plain `allow` here: a manifest's remaining
 * constraints are about its content, not its location, and the ownership and
 * validity checks that carry them run over the reconstructed file content.
 * @param op - the operation the tool is about to perform.
 * @param cls - the class the target path was assigned.
 * @returns the decision, with an already-worded reason when it refuses.
 */
export function decideFsOp(op: FsOp, cls: PathClass): FsDecision {
  return FS_DECISIONS[cls][op]
}

/**
 * The refusal of a create-only write whose target is already present. The rule
 * is the one the class's own row carries, so a refusal reads the same whether
 * the write was refused outright or only because the file was already there.
 * @param path - the resolved target path.
 * @param cls - the create-only class the write met.
 * @returns rule id and model-facing reason.
 */
export function denyExistingCreateOnly(path: string, cls: PathClass): { rule: string; reason: string } {
  if (cls === 'spool-pending') {
    return {
      rule: RULE_SPOOL_CREATE_ONLY,
      reason: `"${path}" is already queued for delivery: write a new request file instead of replacing a queued one.`,
    }
  }
  return {
    rule: RULE_VERSIONS_APPEND_ONLY,
    reason: `"${path}" already exists and versions/ is append-only: compile a new version instead of replacing an archived file.`,
  }
}

/**
 * The refusal a delegated agent reads when a path leaves its project.
 *
 * The studied platform bounded its subagents by prose alone — "do not read the
 * `.claude` directory, stay in your project" — and one environment-check agent
 * still cited four sibling projects' scratch directories as evidence
 * (`clawsgo-analysis/CLAWSGO-SCHEDULING.md` §2.2). Here the bound is a rule of
 * this gate: it applies to every filesystem tool and to every path operand of
 * a shell command, and the sentence tells the agent where the request belongs.
 * @param path - the resolved path outside the delegation's project.
 * @returns the rule id and the model-facing sentence.
 */
export function denyDelegationScope(path: string): { rule: string; reason: string } {
  return {
    rule: RULE_DELEGATION_SCOPE,
    reason: `"${path}" is outside the project this delegation was scoped to: a delegated agent reads and writes `
      + 'only its own project, the skill tree, and the delivery spool. If the task needs something from elsewhere, '
      + 'say so in your report and let the thread that delegated you fetch it.',
  }
}
