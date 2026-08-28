// Every way a skill bundle can be defective, and the two durable schemas the
// projections validate stored rows against. The studied platform degraded
// silently on each of these; here each one names the offending skill.
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  collectChapterReferences,
  computeSkillHash,
  nodeSkillSourceReader,
  parseSkill,
  parseSkillDocument,
  scanSkillRoot,
  skillNameOf,
} from '@deepseek-ai/dsh-sci-skills'
import { skillLifecycleRecordSchema, skillUsageRecordSchema } from '@deepseek-ai/dsh-sci-skills/src/spec.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('parseSkillDocument', () => {
  it.each([
    ['no frontmatter block at all', '# Body only\n', /has no YAML frontmatter block/],
    ['unterminated frontmatter', '---\nname: x\n', /has no YAML frontmatter block/],
    ['invalid YAML', '---\nname: [unclosed\n---\nbody\n', /has invalid YAML frontmatter/],
    ['a scalar frontmatter document', '---\njust a string\n---\nbody\n', /frontmatter is not a mapping/],
    ['a list frontmatter document', '---\n- one\n---\nbody\n', /frontmatter is not a mapping/],
  ])('rejects %s', (_case, raw, message) => {
    expect(() => parseSkillDocument(raw, 'sci-plot')).toThrow(message)
  })

  it('accepts CRLF frontmatter delimiters', () => {
    expect(parseSkillDocument('---\r\nname: sci-plot\r\n---\r\nbody\r\n', 'sci-plot'))
      .toEqual({ data: { name: 'sci-plot' }, body: 'body' })
  })
})

describe('parseSkill', () => {
  it.each([
    ['a name that does not match its directory', '---\nname: other\ndescription: d\n---\nb\n', /declares frontmatter name "other"/],
    ['a missing name', '---\ndescription: d\n---\nb\n', /declares frontmatter name null/],
    ['a non-string name', '---\nname: 7\ndescription: d\n---\nb\n', /declares frontmatter name null/],
    ['a whitespace-only description', '---\nname: sci-plot\ndescription: "   "\n---\nb\n', /has an empty SKILL.md frontmatter description/],
    ['a non-boolean invocation field', '---\nname: sci-plot\ndescription: d\nuser-invocable: maybe\n---\nb\n', /field "user-invocable" must be a boolean/],
  ])('rejects %s', (_case, raw, message) => {
    expect(() => parseSkill(raw, 'sci-plot')).toThrow(message)
  })

  it('rejects a directory name outside the skill-name grammar', () => {
    expect(() => parseSkill('---\nname: Sci_Plot\ndescription: d\n---\nb\n', 'Sci_Plot'))
      .toThrow(/is not a valid kebab-case skill name/)
  })

  it('reads the optional frontmatter fields', () => {
    const raw = [
      '---',
      'name: sci-plot',
      'description: Render figures.',
      'whenToUse: when a figure is asked for',
      'disable-model-invocation: true',
      'user-invocable: false',
      'metadata:',
      '  origin: in-house',
      '---',
      '',
      'Body.',
      '',
    ].join('\n')

    expect(parseSkill(raw, 'sci-plot')).toEqual({
      name: 'sci-plot',
      description: 'Render figures.',
      whenToUse: 'when a figure is asked for',
      invocation: { modelInvocable: false, userInvocable: false },
      metadata: { origin: 'in-house' },
      content: 'Body.',
      bodySha256: createHash('sha256').update('Body.', 'utf8').digest('hex'),
    })
  })

  it.each([
    ['a list', '- one'],
    ['a scalar', 'plain'],
  ])('ignores a metadata field that is %s', (_case, value) => {
    const raw = `---\nname: sci-plot\ndescription: d\nmetadata: ${value === 'plain' ? 'plain' : ''}\n${value === '- one' ? '  - one\n' : ''}---\nb\n`

    expect(parseSkill(raw, 'sci-plot')).not.toHaveProperty('metadata')
  })
})

describe('the host filesystem reader', () => {
  it('skips interpreter and VCS residue in both listings', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-sci-skills-scan-'))
    await mkdir(join(root, 'sci-plot', '__pycache__'), { recursive: true })
    await mkdir(join(root, 'sci-plot', 'code'), { recursive: true })
    await mkdir(join(root, '.git'), { recursive: true })
    await writeFile(join(root, 'sci-plot', 'SKILL.md'), '---\nname: sci-plot\ndescription: d\n---\nb\n')
    await writeFile(join(root, 'sci-plot', 'code', 'plot.py'), 'print(1)')
    await writeFile(join(root, 'sci-plot', '__pycache__', 'plot.pyc'), 'bytecode')

    await expect(nodeSkillSourceReader.listSkillNames(root)).resolves.toEqual(['sci-plot'])
    const hashed = await computeSkillHash(join(root, 'sci-plot'))
    expect(Object.keys(hashed.files)).toEqual(['SKILL.md', 'code/plot.py'])
    await expect(scanSkillRoot(root, nodeSkillSourceReader)).resolves.toHaveLength(1)
  })
})

describe('durable projection schemas', () => {
  const session = SessionId('11111111-1111-4111-8111-111111111111')

  it('accepts a well-formed usage row and rejects an inverted one', () => {
    const row = { skillName: 'sci-plot', firstUsedAt: 10, lastUsedAt: 20, count: 2, lastSessionId: session }

    expect(skillUsageRecordSchema.parse(row)).toEqual(row)
    expect(() => skillUsageRecordSchema.parse({ ...row, lastUsedAt: 5 }))
      .toThrow(/lastUsedAt must not precede firstUsedAt/)
  })

  it('accepts a well-formed lifecycle row and rejects an unknown state', () => {
    const row = { skillName: 'sci-plot', state: 'stale', pinned: false, firstSeenAt: 10, updatedAt: 20 }

    expect(skillLifecycleRecordSchema.parse(row)).toEqual(row)
    expect(() => skillLifecycleRecordSchema.parse({ ...row, state: 'retired' })).toThrow()
  })
})

describe('collectChapterReferences', () => {
  it('collects each cited chapter title once, in first-occurrence order', () => {
    const body = 'See the "Delivering files" section of the system prompt, and again the "Delivering files" section of the system prompt.'
    expect(collectChapterReferences(body)).toEqual(['Delivering files'])
  })

  it('returns nothing when the body cites no chapter', () => {
    expect(collectChapterReferences('No citations here.')).toEqual([])
  })
})

describe('skillNameOf', () => {
  it('takes the trailing segment of a sync directory argument', () => {
    expect(skillNameOf('/sci-plot')).toBe('sci-plot')
    expect(skillNameOf('root/sub/sci-paper')).toBe('sci-paper')
  })

  it('yields the empty string when the argument holds no segment', () => {
    expect(skillNameOf('')).toBe('')
    expect(skillNameOf('/')).toBe('')
  })
})
