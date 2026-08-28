// The path table is the executable form of the workspace contract's rules
// table, so every cell is asserted rather than sampled: a silently widened cell
// is exactly the regression that lets an agent overwrite an archived version.
import { describe, expect, it } from 'vitest'
import {
  FS_DENIAL_RULES,
  PATH_CLASSES,
  RULE_REFERENCES_OUTSIDE_PAPERS,
  RULE_RENDER_OWNED_VERSIONS,
  RULE_SCI_PRIVATE,
  RULE_SKILLS_READ_ONLY,
  RULE_SPOOL_CREATE_ONLY,
  RULE_VERSIONS_APPEND_ONLY,
  decideFsOp,
  denyExistingCreateOnly,
} from '@deepseek-ai/dsh-sci-workspace'
import type { FsOp, PathClass } from '@deepseek-ai/dsh-sci-workspace'

/** `allow`, `create-only`, or the rule id of a refusal. */
function cell(op: FsOp, cls: PathClass): string {
  const decision = decideFsOp(op, cls)
  if (decision.kind === 'deny') return decision.rule
  return decision.kind
}

const WRITE_TABLE: Readonly<Record<PathClass, string>> = {
  'workspace': 'allow',
  'tmp': 'allow',
  'paper-src': 'allow',
  'paper-manifest': 'allow',
  'paper-versions': 'allow-if-absent',
  'sciplot-code': 'allow',
  'sciplot-manifest': 'allow',
  'sciplot-versions': RULE_RENDER_OWNED_VERSIONS,
  'references': RULE_REFERENCES_OUTSIDE_PAPERS,
  'skills': RULE_SKILLS_READ_ONLY,
  'spool-pending': 'allow-if-absent',
  'private': RULE_SCI_PRIVATE,
  'other': 'allow',
}

const EDIT_TABLE: Readonly<Record<PathClass, string>> = {
  ...WRITE_TABLE,
  'paper-versions': RULE_VERSIONS_APPEND_ONLY,
  'spool-pending': RULE_SPOOL_CREATE_ONLY,
}

describe('decideFsOp', () => {
  it.each(PATH_CLASSES)('lets a read of a %s path through; only its bytes can refuse it', (cls) => {
    expect(cell('read', cls)).toBe('allow')
  })

  it.each(PATH_CLASSES)('decides a write to a %s path as the contract table states', (cls) => {
    expect(cell('write', cls)).toBe(WRITE_TABLE[cls])
  })

  it.each(PATH_CLASSES)('decides an edit of a %s path as the contract table states', (cls) => {
    expect(cell('edit', cls)).toBe(EDIT_TABLE[cls])
  })

  it('names a rule from the published vocabulary in every refusal', () => {
    for (const cls of PATH_CLASSES) {
      for (const op of ['read', 'write', 'edit'] as const) {
        const decision = decideFsOp(op, cls)
        if (decision.kind !== 'deny') continue
        expect(FS_DENIAL_RULES.has(decision.rule)).toBe(true)
        expect(decision.reason.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('denyExistingCreateOnly', () => {
  it('points an append-only version store at adding a version', () => {
    const denial = denyExistingCreateOnly('/sci/projects/p1/papers/nn/versions/v1/main.tex', 'paper-versions')
    expect(denial.rule).toBe(RULE_VERSIONS_APPEND_ONLY)
    expect(denial.reason).toContain('append-only')
  })

  it('points a queued delivery at writing a new request', () => {
    const denial = denyExistingCreateOnly('/sci/.sci/spool/pending/2f0c.json', 'spool-pending')
    expect(denial.rule).toBe(RULE_SPOOL_CREATE_ONLY)
    expect(denial.reason).toContain('already queued for delivery')
  })
})
