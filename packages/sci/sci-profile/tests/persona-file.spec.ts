import { describe, expect, it } from 'vitest'
import type { PlanIcon } from '@deepseek-ai/dsh-sci-plan'
import { ICON_PERSONA, PERSONA_NAMES } from '@deepseek-ai/dsh-sci-plan'
import {
  PERSONAS_SECTION_ORDER,
  SECTION_PERSONAS,
  assertCompleteRoster,
  parsePersonaDocument,
  renderPersonaRoster,
} from '../src/persona-file.ts'
import type { SciPersona } from '../src/types.ts'

const SOURCE = '/agents/researcher.md'

function document(frontmatter: string, body = 'Charter body.\n'): string {
  return `---\n${frontmatter}\n---\n${body}`
}

function persona(name: string, overrides: Partial<SciPersona> = {}): SciPersona {
  return { name, summary: `${name} summary`, charter: `${name} charter`, ...overrides } as SciPersona
}

describe('parsePersonaDocument', () => {
  it('reads name, summary, icon, and the trimmed charter body', () => {
    const parsed = parsePersonaDocument(
      document('name: researcher\nicon: web\nsummary: Gathers sources.', '\nFirst line.\n\nSecond line.\n\n'),
      SOURCE,
    )

    expect(parsed).toEqual({
      name: 'researcher',
      icon: 'web',
      summary: 'Gathers sources.',
      charter: 'First line.\n\nSecond line.',
    })
  })

  it('accepts a persona no icon reaches', () => {
    const parsed = parsePersonaDocument(document('name: plotter\nsummary: Renders figures.'), SOURCE)

    expect(parsed.icon).toBeUndefined()
    expect(parsed.name).toBe('plotter')
  })

  it('reads a document written with CRLF line endings', () => {
    const parsed = parsePersonaDocument('---\r\nname: scout\r\nsummary: Finds things.\r\n---\r\nBody.\r\n', SOURCE)

    expect(parsed.summary).toBe('Finds things.')
    expect(parsed.charter).toBe('Body.')
  })

  it('refuses a document that does not open with a frontmatter fence', () => {
    expect(() => parsePersonaDocument('name: scout\n', SOURCE))
      .toThrow(/must open with a "---" frontmatter block/)
  })

  it('refuses a frontmatter block that is never closed', () => {
    expect(() => parsePersonaDocument('---\nname: scout\n', SOURCE))
      .toThrow(/must open with a "---" frontmatter block/)
  })

  it('refuses frontmatter that is not a mapping', () => {
    expect(() => parsePersonaDocument(document('- scout'), SOURCE))
      .toThrow(/frontmatter that is not a mapping/)
  })

  it('refuses frontmatter that parses to null', () => {
    expect(() => parsePersonaDocument('---\n\n---\nBody.\n', SOURCE))
      .toThrow(/frontmatter that is not a mapping/)
  })

  it('refuses a missing name', () => {
    expect(() => parsePersonaDocument(document('summary: Gathers sources.'), SOURCE))
      .toThrow(/must declare a non-empty "name"/)
  })

  it('refuses a blank summary', () => {
    expect(() => parsePersonaDocument(document('name: scout\nsummary: "   "'), SOURCE))
      .toThrow(/must declare a non-empty "summary"/)
  })

  it('refuses a name no persona declares', () => {
    expect(() => parsePersonaDocument(document('name: reviewer\nsummary: Reviews.'), SOURCE))
      .toThrow(/is not one of the personas @deepseek-ai\/dsh-sci-plan defines/)
  })

  it('refuses an empty charter body', () => {
    expect(() => parsePersonaDocument(document('name: scout\nsummary: Finds things.', '   \n'), SOURCE))
      .toThrow(/has an empty charter body/)
  })

  it('refuses an icon that is not a plan icon', () => {
    expect(() => parsePersonaDocument(document('name: scout\nicon: telescope\nsummary: Finds things.'), SOURCE))
      .toThrow(/routes that icon to "no persona"/)
  })

  it('refuses an icon that routes to a different persona', () => {
    expect(() => parsePersonaDocument(document('name: scout\nicon: web\nsummary: Finds things.'), SOURCE))
      .toThrow(/routes that icon to "researcher"/)
  })

  it('refuses a non-string icon', () => {
    expect(() => parsePersonaDocument(document('name: scout\nicon: 3\nsummary: Finds things.'), SOURCE))
      .toThrow(/must declare a non-empty "icon"/)
  })
})

describe('assertCompleteRoster', () => {
  it('accepts exactly the declared personas', () => {
    expect(() => { assertCompleteRoster(PERSONA_NAMES.map(name => persona(name))) }).not.toThrow()
  })

  it('refuses a duplicate declaration', () => {
    expect(() => { assertCompleteRoster([...PERSONA_NAMES, 'scout'].map(name => persona(name))) })
      .toThrow(/persona "scout" is declared by two documents/)
  })

  it('names every persona a roster is missing', () => {
    const partial = PERSONA_NAMES.filter(name => name !== 'plotter' && name !== 'writer')
    expect(() => { assertCompleteRoster(partial.map(name => persona(name))) })
      .toThrow(/missing "writer", "plotter"/)
  })
})

describe('renderPersonaRoster', () => {
  it('names the selecting icon, or says none reaches the persona', () => {
    const text = renderPersonaRoster([
      persona('researcher', { icon: 'web' }),
      persona('plotter'),
    ])

    expect(text).toContain('### researcher (selected by the `web` icon)')
    expect(text).toContain('### plotter (no icon selects it)')
    expect(text).toContain('researcher charter')
    expect(text.endsWith('plotter charter')).toBe(true)
  })

  it('is registered under a stable title and between the orchestration and irreversible chapters', () => {
    expect(SECTION_PERSONAS).toBe('Research personas')
    expect(PERSONAS_SECTION_ORDER).toBeGreaterThan(150)
    expect(PERSONAS_SECTION_ORDER).toBeLessThan(165)
  })

  it('covers every icon the plan tool can declare', () => {
    const text = renderPersonaRoster(PERSONA_NAMES.map((name) => {
      const icon = Object.keys(ICON_PERSONA).find(key => ICON_PERSONA[key as keyof typeof ICON_PERSONA] === name)
      return icon === undefined ? persona(name) : persona(name, { icon: icon as PlanIcon })
    }))

    for (const [icon, name] of Object.entries(ICON_PERSONA)) {
      expect(text).toContain(`### ${name} (selected by the \`${icon}\` icon)`)
    }
  })
})
