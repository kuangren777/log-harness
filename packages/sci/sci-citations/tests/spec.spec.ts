// The durable declaration: the two tables, and the one cross-column rule the
// row schema carries — a citation's id is derived from the project and citekey
// it is filed under, so a row whose id disagrees would be reachable by a key
// nothing computes.
import { describe, expect, it } from 'vitest'
import {
  CITATION_GROUP_TABLE,
  CITATION_TABLE,
  citationGroupSchema,
  citationSchema,
  sciCitationsDomainSpec,
} from '../src/spec.ts'
import { PROJECT, citation } from './fixtures.ts'

describe('sciCitationsDomainSpec', () => {
  it('declares the two documented tables', () => {
    expect(sciCitationsDomainSpec.name).toBe('sci_citations')
    expect(Object.keys(sciCitationsDomainSpec.tables).sort()).toEqual([CITATION_TABLE, CITATION_GROUP_TABLE].sort())
  })
})

describe('citationSchema', () => {
  it('accepts a row with every optional column absent', () => {
    const row = citation({ year: undefined, venue: undefined, doi: undefined })

    expect(citationSchema.parse(row)).toMatchObject({ id: 'snse:zhao2015' })
  })

  it('accepts a row carrying every optional column', () => {
    const row = citation({ libraryId: 'doi:10.1/x', arxivId: '1501.00001', url: 'u', note: 'n', lastScanAt: 1 })

    expect(citationSchema.parse(row)).toMatchObject({ note: 'n' })
  })

  it('rejects a row whose id does not derive from its project and citekey', () => {
    expect(() => citationSchema.parse(citation({ id: 'other:zhao2015' })))
      .toThrow('sci citation id must be `${project}:${citekey}`')
  })

  it('rejects a confidence outside 0..100 and a negative use count', () => {
    expect(() => citationSchema.parse(citation({ confidence: 101 }))).toThrow()
    expect(() => citationSchema.parse(citation({ uses: -1 }))).toThrow()
  })
})

describe('citationGroupSchema', () => {
  it('accepts a group and rejects one with no label', () => {
    const group = { project: PROJECT, key: 'method', label: 'Method', color: '#3b82f6', order: 0 }

    expect(citationGroupSchema.parse(group)).toEqual(group)
    expect(() => citationGroupSchema.parse({ ...group, label: '' })).toThrow()
  })
})
