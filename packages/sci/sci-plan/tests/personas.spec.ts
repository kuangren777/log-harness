// ICON_PERSONA is a cross-package contract: sci-tier asserts that the agent
// definitions it installs cover its value set, so a mapping that names a
// persona the profile does not ship would fail at fan-out rather than at load.
import { describe, expect, it } from 'vitest'
import { ICON_PERSONA, PERSONA_NAMES, PLAN_ICONS } from '@deepseek-ai/dsh-sci-plan'

describe('sci-plan icon-to-persona contract', () => {
  it('maps every declarable icon', () => {
    expect(Object.keys(ICON_PERSONA).sort()).toEqual([...PLAN_ICONS].sort())
  })

  it('maps the five icons to the five personas the plan schema can reach', () => {
    expect(ICON_PERSONA).toEqual({
      web: 'researcher',
      search: 'scout',
      security: 'adversary',
      code: 'writer',
      check: 'deliverer',
    })
  })

  it('names only personas the profile ships', () => {
    expect(PERSONA_NAMES).toContain('plotter')
    for (const persona of Object.values(ICON_PERSONA)) expect(PERSONA_NAMES).toContain(persona)
  })

  it('leaves plotter unreachable from any icon, so figure work is selected by task text', () => {
    expect(Object.values(ICON_PERSONA)).not.toContain('plotter')
    expect(new Set(Object.values(ICON_PERSONA)).size).toBe(PLAN_ICONS.length)
  })
})
