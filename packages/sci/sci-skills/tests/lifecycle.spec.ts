// 04-T4: the curation rule with an injected clock — ninety days of disuse make
// an unpinned skill stale, a pinned skill never moves, and a skill that left
// the tree is archived rather than forgotten. Also pins the listing filter the
// provider derives from those states.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  MILLISECONDS_PER_DAY,
  REMOVED_FROM_TREE_REASON,
  SciSkillProvider,
  curateLifecycle,
  firstSentence,
  foldUsage,
  parseSkillToolArgument,
  type SkillCatalogEntry,
  type SkillLifecycleRecord,
  type SkillUsageRecord,
} from '@deepseek-ai/dsh-sci-skills'

/** Body loader for the provider tests: the body is `# <name>`, keyed by the entry's name. */
const loadSkillBody = (entry: { name: string }): Promise<{ content: string; sha256: string }> => {
  const content = `# ${entry.name}`
  return Promise.resolve({ content, sha256: createHash('sha256').update(content, 'utf8').digest('hex') })
}

const NOW = 1_800_000_000_000
const SESSION = SessionId('11111111-1111-4111-8111-111111111111')

/**
 * Build a usage row whose last load is a given age.
 * @param skillName - the skill.
 * @param daysAgo - age of the last recorded load, in days.
 * @returns the usage row.
 */
function usedDaysAgo(skillName: string, daysAgo: number): SkillUsageRecord {
  const at = NOW - daysAgo * MILLISECONDS_PER_DAY
  return { skillName, firstUsedAt: at, lastUsedAt: at, count: 1, lastSessionId: SESSION }
}

/**
 * Build a stored lifecycle row.
 * @param skillName - the skill.
 * @param overrides - fields differing from an active, unpinned, freshly seen row.
 * @returns the stored row.
 */
function stored(skillName: string, overrides: Partial<SkillLifecycleRecord> = {}): SkillLifecycleRecord {
  return { skillName, state: 'active', pinned: false, firstSeenAt: NOW, updatedAt: NOW, ...overrides }
}

/**
 * Curate one round with the fixture defaults.
 * @param input - the parts differing from a single unused, unpinned skill.
 * @returns the projected rows.
 */
function curate(input: {
  present?: readonly string[]
  usage?: readonly SkillUsageRecord[]
  stored?: readonly SkillLifecycleRecord[]
  pinned?: readonly string[]
}): Map<string, SkillLifecycleRecord> {
  return curateLifecycle({
    present: input.present ?? ['sci-plot'],
    usage: new Map((input.usage ?? []).map(record => [record.skillName, record])),
    stored: new Map((input.stored ?? []).map(record => [record.skillName, record])),
    pinned: new Set(input.pinned ?? []),
    staleAfterDays: 90,
    now: NOW,
  })
}

describe('curateLifecycle', () => {
  it('keeps a recently used skill active', () => {
    expect(curate({ usage: [usedDaysAgo('sci-plot', 10)] }).get('sci-plot')?.state).toBe('active')
  })

  it('makes a skill unused past the horizon stale', () => {
    expect(curate({ usage: [usedDaysAgo('sci-plot', 91)] }).get('sci-plot')?.state).toBe('stale')
  })

  it('keeps a skill exactly at the horizon active', () => {
    expect(curate({ usage: [usedDaysAgo('sci-plot', 90)] }).get('sci-plot')?.state).toBe('active')
  })

  it('never demotes a pinned skill, however old its last use', () => {
    const projected = curate({ usage: [usedDaysAgo('sci-plot', 400)], pinned: ['sci-plot'] })

    expect(projected.get('sci-plot')).toMatchObject({ state: 'active', pinned: true })
  })

  it('ages a never-used skill from when it first entered the tree', () => {
    const old = stored('sci-plot', { firstSeenAt: NOW - 200 * MILLISECONDS_PER_DAY })

    expect(curate({ stored: [old] }).get('sci-plot')?.state).toBe('stale')
    expect(curate({}).get('sci-plot')).toMatchObject({ state: 'active', firstSeenAt: NOW })
  })

  it('archives a stored skill that left the tree', () => {
    const projected = curate({ present: [], stored: [stored('sci-gone')] })

    expect(projected.get('sci-gone')).toMatchObject({
      state: 'archived',
      archivedReason: REMOVED_FROM_TREE_REASON,
    })
  })

  it('keeps an existing archive reason when the skill stays gone', () => {
    const archived = stored('sci-gone', { state: 'archived', archivedReason: 'retired by the maintainer' })

    expect(curate({ present: [], stored: [archived] }).get('sci-gone')).toBe(archived)
  })

  it('returns the stored row unchanged when nothing but the clock moved', () => {
    const existing = stored('sci-plot')

    expect(curate({ stored: [existing] }).get('sci-plot')).toBe(existing)
  })

  it('replaces the row when its state moves', () => {
    const existing = stored('sci-plot')
    const projected = curate({ stored: [existing], usage: [usedDaysAgo('sci-plot', 200)] })

    expect(projected.get('sci-plot')).not.toBe(existing)
    expect(projected.get('sci-plot')?.updatedAt).toBe(NOW)
  })
})

describe('foldUsage', () => {
  it('opens a row on the first recorded load', () => {
    expect(foldUsage(undefined, 'sci-plot', SESSION, NOW)).toEqual({
      skillName: 'sci-plot',
      firstUsedAt: NOW,
      lastUsedAt: NOW,
      count: 1,
      lastSessionId: SESSION,
    })
  })

  it('advances the count and the recency, never regressing lastUsedAt', () => {
    const first = foldUsage(undefined, 'sci-plot', SESSION, NOW)

    expect(foldUsage(first, 'sci-plot', SESSION, NOW + 5)).toMatchObject({ count: 2, firstUsedAt: NOW, lastUsedAt: NOW + 5 })
    expect(foldUsage(first, 'sci-plot', SESSION, NOW - 5)).toMatchObject({ count: 2, lastUsedAt: NOW })
  })
})

describe('parseSkillToolArgument', () => {
  it.each([
    ['a well-formed call', '{"name":"sci-plot"}', 'sci-plot'],
    ['malformed JSON', '{"name"', undefined],
    ['a JSON array', '["sci-plot"]', undefined],
    ['a null document', 'null', undefined],
    ['a missing name', '{"skill":"sci-plot"}', undefined],
    ['an empty name', '{"name":""}', undefined],
    ['a non-string name', '{"name":7}', undefined],
  ])('reads %s', (_case, raw, expected) => {
    expect(parseSkillToolArgument(raw)).toBe(expected)
  })
})

describe('firstSentence', () => {
  it.each([
    ['English prose', 'Render figures. Everything else follows.', 'Render figures.'],
    ['CJK prose', '绘制科研图。其余内容随后。', '绘制科研图。'],
    ['a terminator at the very end', 'Render figures.', 'Render figures.'],
    ['no terminator at all', 'Render figures', 'Render figures'],
  ])('shortens %s', (_case, description, expected) => {
    expect(firstSentence(description)).toBe(expected)
  })
})

describe('SciSkillProvider listing filter', () => {
  const skill = (name: string): SkillCatalogEntry => ({
    name,
    description: 'One line. And a second one.',
    invocation: { modelInvocable: true, userInvocable: true },
    bodySha256: createHash('sha256').update(`# ${name}`, 'utf8').digest('hex'),
    files: {},
  })
  const catalog = [skill('active-one'), skill('stale-one'), skill('archived-one')]
  // 'active-one' is deliberately absent: a skill the projection has not
  // reached yet must list in full rather than vanish.
  const states = new Map<string, SkillLifecycleRecord['state']>([
    ['stale-one', 'stale'],
    ['archived-one', 'archived'],
  ])
  const provider = new SciSkillProvider({
    providerName: 'sci',
    catalog,
    sandboxRoot: '/home/user/sci/skills',
    lifecycleStates: () => states,
    loadSkillBody,
  })

  it('lists an active skill in full, a stale one in one line, and omits an archived one', async () => {
    const listed = await provider.list()

    expect(listed.map(candidate => [candidate.name, candidate.description])).toEqual([
      ['active-one', 'One line. And a second one.'],
      ['stale-one', 'One line.'],
    ])
  })

  it('points every candidate at its sandbox copy', async () => {
    const [candidate] = await provider.list()

    expect(candidate).toMatchObject({
      provider: 'sci',
      source: 'bundled',
      path: '/home/user/sci/skills/active-one/SKILL.md',
      resourceBase: { kind: 'directory', path: '/home/user/sci/skills/active-one' },
    })
  })

  it('carries whenToUse and metadata through to the definition', async () => {
    const rich = new SciSkillProvider({
      providerName: 'sci',
      catalog: [{ ...skill('rich'), whenToUse: 'when asked', metadata: { hidden: true } }],
      sandboxRoot: '/home/user/sci/skills',
      lifecycleStates: () => new Map(),
      loadSkillBody,
    })
    const [candidate] = await rich.list()

    await expect(rich.get(candidate!, {})).resolves.toMatchObject({
      whenToUse: 'when asked',
      metadata: { hidden: true },
      content: '# rich',
      reference: { store: 'sci', id: 'rich', sha256: createHash('sha256').update('# rich', 'utf8').digest('hex') },
    })
  })

  it('loads a listed skill and refuses one that stopped being listed', async () => {
    const [candidate] = await provider.list()

    await expect(provider.get(candidate!, {})).resolves.toMatchObject({ name: 'active-one', content: '# active-one' })
    await expect(provider.get({ ...candidate!, locator: { skillName: 'archived-one' } }, {})).resolves.toBeUndefined()
    await expect(provider.get({ ...candidate!, locator: { skillName: 'never-existed' } }, {})).resolves.toBeUndefined()
  })
})
