// The pure half of 04-T5: what the observer recognizes as a memory node, and
// the literal edit it plans when the node has lost its transcript back-pointer.
import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { METADATA_KEY, ORIGIN_SESSION_KEY, parseMemoryFrontmatter, planOriginBackfill } from '@deepseek-ai/dsh-sci-memory'

const SESSION = SessionId('11111111-2222-3333-4444-555555555555')

const COMPLETE = [
  '---',
  'name: agent-fuzzing-research',
  'description: Research paper on fuzzing LLM-based agents',
  'metadata:',
  '  node_type: memory',
  '  type: project',
  `  ${ORIGIN_SESSION_KEY}: 97df9841-f244-4baf-b443-b663f0aa5884`,
  '---',
  '',
  'Body.',
  '',
].join('\n')

const WITHOUT_ORIGIN = [
  '---',
  'name: agent-fuzzing-research',
  'description: Research paper on fuzzing LLM-based agents',
  'metadata:',
  '  node_type: memory',
  '  type: project',
  '---',
  '',
  'Body mentioning metadata: in prose.',
  '',
].join('\n')

const WITHOUT_METADATA = [
  '---',
  'name: bare-node',
  'description: A node with no metadata mapping at all',
  '---',
  '',
  'Body.',
  '',
].join('\n')

/**
 * Apply a planned literal edit the way `FileSystem.editText` would.
 * @param text - the file content before the edit.
 * @param sessionId - the origin to backfill.
 * @returns the content after the single literal replacement.
 */
function applyBackfill(text: string, sessionId: SessionId): string {
  const edit = planOriginBackfill(text, sessionId)
  expect(edit).toBeDefined()
  expect(text.split(edit!.oldString)).toHaveLength(2)
  return text.replace(edit!.oldString, edit!.newString)
}

describe('parseMemoryFrontmatter', () => {
  it('reads the name, description, type, and origin of a complete node', () => {
    expect(parseMemoryFrontmatter(COMPLETE)).toEqual({
      name: 'agent-fuzzing-research',
      description: 'Research paper on fuzzing LLM-based agents',
      type: 'project',
      originSessionId: '97df9841-f244-4baf-b443-b663f0aa5884',
    })
  })

  it('omits an origin the node does not declare', () => {
    expect(parseMemoryFrontmatter(WITHOUT_ORIGIN)).toEqual({
      name: 'agent-fuzzing-research',
      description: 'Research paper on fuzzing LLM-based agents',
      type: 'project',
    })
  })

  it('omits a metadata type outside the four known kinds', () => {
    const text = COMPLETE.replace('type: project', 'type: invented')
    expect(parseMemoryFrontmatter(text)?.type).toBeUndefined()
  })

  it('omits fields whose value is blank or not a string', () => {
    const text = ['---', 'name: "   "', 'description: 5', 'metadata:', '  type: "  "', '---', '', 'Body.', ''].join('\n')
    expect(parseMemoryFrontmatter(text)).toEqual({})
  })

  it('omits metadata fields when metadata is not a mapping', () => {
    const text = ['---', 'name: listy', 'metadata:', '  - project', '---', '', 'Body.', ''].join('\n')
    expect(parseMemoryFrontmatter(text)).toEqual({ name: 'listy' })
  })

  it('is undefined for a file with no frontmatter', () => {
    expect(parseMemoryFrontmatter('# Just a heading\n')).toBeUndefined()
  })

  it('is undefined for unparseable frontmatter YAML', () => {
    expect(parseMemoryFrontmatter('---\nname: [unclosed\n---\n\nBody.\n')).toBeUndefined()
  })

  it('is undefined when the frontmatter is not a mapping', () => {
    expect(parseMemoryFrontmatter('---\n- one\n- two\n---\n\nBody.\n')).toBeUndefined()
  })
})

describe('planOriginBackfill', () => {
  it('adds the origin under an existing metadata mapping, matching its indentation', () => {
    expect(applyBackfill(WITHOUT_ORIGIN, SESSION)).toBe([
      '---',
      'name: agent-fuzzing-research',
      'description: Research paper on fuzzing LLM-based agents',
      'metadata:',
      `  ${ORIGIN_SESSION_KEY}: ${SESSION}`,
      '  node_type: memory',
      '  type: project',
      '---',
      '',
      'Body mentioning metadata: in prose.',
      '',
    ].join('\n'))
  })

  it('creates the metadata mapping when the node declares none', () => {
    expect(applyBackfill(WITHOUT_METADATA, SESSION)).toBe([
      '---',
      'name: bare-node',
      'description: A node with no metadata mapping at all',
      `${METADATA_KEY}:`,
      `  ${ORIGIN_SESSION_KEY}: ${SESSION}`,
      '---',
      '',
      'Body.',
      '',
    ].join('\n'))
  })

  it('preserves CRLF line endings', () => {
    const crlf = WITHOUT_METADATA.replaceAll('\n', '\r\n')
    expect(applyBackfill(crlf, SESSION)).toContain(`\r\n  ${ORIGIN_SESSION_KEY}: ${SESSION}\r\n`)
  })

  it('uses the mapping\'s own four-space indentation', () => {
    const text = WITHOUT_ORIGIN.replaceAll('\n  ', '\n    ')
    expect(applyBackfill(text, SESSION)).toContain(`\n    ${ORIGIN_SESSION_KEY}: ${SESSION}\n`)
  })

  it('plans nothing for a node that already records an origin', () => {
    expect(planOriginBackfill(COMPLETE, SESSION)).toBeUndefined()
  })

  it('plans nothing for a file that is not a memory node', () => {
    expect(planOriginBackfill('# Just a heading\n', SESSION)).toBeUndefined()
  })
})
