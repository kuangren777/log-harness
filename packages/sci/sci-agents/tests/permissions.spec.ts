// The two directions of the permission mapping: what a resolved deny list says
// about the three switches, and what a switch gesture writes back into the user
// layer without disturbing denials it does not own.
import { describe, expect, it } from 'vitest'
import { PERMISSION_KEYS, readPermissions, writePermissions } from '@deepseek-ai/dsh-sci-agents'
import type { PermissionTools } from '@deepseek-ai/dsh-sci-agents'

const TOOLS: PermissionTools = {
  web: ['web_search', 'web_fetch', 'literature_search'],
  code: ['bash', 'write', 'edit', 'univer_execute'],
  writeLibrary: ['library_add', 'citations_add'],
}

const ALL_ON = { web: true, code: true, writeLibrary: true }

describe('readPermissions', () => {
  it('grants every switch when nothing is denied', () => {
    expect(readPermissions(undefined, TOOLS)).toEqual(ALL_ON)
    expect(readPermissions([], TOOLS)).toEqual(ALL_ON)
  })

  it('withdraws one switch per denied group', () => {
    expect(readPermissions(['web_search', 'web_fetch', 'literature_search'], TOOLS))
      .toEqual({ web: false, code: true, writeLibrary: true })
    expect(readPermissions(['library_add', 'citations_add'], TOOLS))
      .toEqual({ web: true, code: true, writeLibrary: false })
  })

  it('withdraws a switch as soon as ANY tool of its group is denied', () => {
    // A child that lost web_search but kept web_fetch does not have the web
    // permission; reporting it as granted would describe a capability it lacks.
    expect(readPermissions(['web_search'], TOOLS).web).toBe(false)
    expect(readPermissions(['univer_execute'], TOOLS).code).toBe(false)
  })

  it('ignores denials outside the three groups', () => {
    expect(readPermissions(['job_kill', 'deliver_files'], TOOLS)).toEqual(ALL_ON)
  })
})

describe('writePermissions', () => {
  it('writes nothing when every switch is on and nothing else was stored', () => {
    expect(writePermissions(undefined, ALL_ON, TOOLS)).toBeUndefined()
    expect(writePermissions(['bash'], ALL_ON, TOOLS)).toBeUndefined()
  })

  it('emits the whole group of a switch turned off, in group order', () => {
    expect(writePermissions(undefined, { web: false, code: false, writeLibrary: true }, TOOLS))
      .toEqual(['web_search', 'web_fetch', 'literature_search', 'bash', 'write', 'edit', 'univer_execute'])
  })

  it('keeps denials this mapping does not own', () => {
    // `job_kill` was written by something else — a deployment document or a
    // composition entry — and a permission gesture must not silently lift it.
    expect(writePermissions(['job_kill', 'bash'], { ...ALL_ON, writeLibrary: false }, TOOLS))
      .toEqual(['job_kill', 'library_add', 'citations_add'])
  })

  it('does not duplicate a name the stored list already carried', () => {
    expect(writePermissions(['library_add'], { ...ALL_ON, writeLibrary: false }, TOOLS))
      .toEqual(['library_add', 'citations_add'])
  })

  it('round-trips: what it writes is what readPermissions reports', () => {
    for (const key of PERMISSION_KEYS) {
      const requested = { ...ALL_ON, [key]: false }
      expect(readPermissions(writePermissions(undefined, requested, TOOLS), TOOLS)).toEqual(requested)
    }
  })
})
