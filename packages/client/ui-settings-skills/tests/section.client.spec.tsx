// @vitest-environment jsdom
/**
 * What the Skills section shows: the discovery scope, the origin groups in the
 * order the Host returned them, each row's two surfaces, the override marker
 * and its reset, the read-only postures, and the states with nothing to list.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SkillInventory, SkillInventoryGroup } from '@deepseek-ai/dsh-api-remotes/client'
import { SkillsSection, type SkillsSectionProps } from '../src/client/SkillsSection.tsx'
import type { SkillsSectionState } from '../src/client/skills-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en, params?: Record<string, string>): string =>
  en[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)

/** Two origin groups: the nearer project copy, then the user copy it shadows. */
function inventory(overrides: Partial<SkillInventory> = {}): SkillInventory {
  return {
    groups: [
      {
        source: 'project-dsh',
        rank: 0,
        root: '/proj/.dsh/skills',
        layer: 'scope',
        skills: [{
          name: 'fixture-demo',
          description: 'the winner',
          path: '/proj/.dsh/skills/fixture-demo/SKILL.md',
          authored: { modelInvocable: true, userInvocable: true },
          effective: { modelInvocable: true, userInvocable: true },
          shadowed: false,
        }],
      },
      {
        source: 'user-dsh',
        rank: 10,
        root: '/home/dev/.dsh/skills',
        layer: 'global',
        skills: [
          {
            name: 'fixture-user-only',
            description: 'overridden off for the model',
            path: '/home/dev/.dsh/skills/fixture-user-only/SKILL.md',
            authored: { modelInvocable: true, userInvocable: true },
            effective: { modelInvocable: false, userInvocable: true },
            override: { model: false },
            shadowed: false,
          },
          {
            name: 'fixture-demo',
            description: 'the loser',
            path: '/home/dev/.dsh/skills/fixture-demo/SKILL.md',
            authored: { modelInvocable: true, userInvocable: true },
            effective: { modelInvocable: true, userInvocable: true },
            shadowed: true,
          },
        ],
      },
    ],
    complete: true,
    ...overrides,
  }
}

/** One group without its discovery root, as a provider that scans no directory reports. */
function withoutRoot(group: SkillInventoryGroup): SkillInventoryGroup {
  const { root: _discardedRoot, ...rest } = group
  return rest
}

function renderSection(state: Partial<SkillsSectionState> = {}) {
  const store = createSnapshotStore<SkillsSectionState>({
    status: 'ready',
    cwd: '/home/dev/proj',
    home: '/home/dev',
    inventory: inventory(),
    error: undefined,
    writable: true,
    ...state,
  })
  const actions = { refresh: vi.fn(), setModel: vi.fn(), setUser: vi.fn(), reset: vi.fn() }
  const props = { ...actions, t, useSkills: bindSnapshotSelector(store) } as unknown as SkillsSectionProps
  render(<SkillsSection {...props} />)
  return actions
}

describe('SkillsSection', () => {
  it('renders null until the shell injects the section dependencies', () => {
    expect(SkillsSection({})).toBeNull()
  })

  it('shows the discovery scope with the home abbreviated', () => {
    renderSection()
    expect(screen.getByText('Discovered for ~/proj')).toBeTruthy()
  })

  it('lists the origin groups nearest first with their localized labels and roots', () => {
    renderSection()
    const headings = screen.getAllByRole('heading', { level: 4 }).map(node => node.textContent)
    expect(headings).toEqual(['Project (.dsh/skills)', 'User (.dsh/skills)'])
    expect(screen.getByText('/proj/.dsh/skills')).toBeTruthy()
    expect(screen.getByText('~/.dsh/skills')).toBeTruthy()
  })

  it('renders an unrecognized origin bucket raw rather than mislabelled', () => {
    const custom = inventory()
    renderSection({
      inventory: {
        ...custom,
        groups: [{ ...withoutRoot(custom.groups[0]!), source: 'from-the-future' }],
      },
    })
    expect(screen.getByRole('heading', { level: 4 }).textContent).toBe('from-the-future')
    expect(screen.queryByText('/proj/.dsh/skills')).toBeNull()
  })

  it('keys a provider-contributed skill that has no file by its name', () => {
    const base = inventory()
    renderSection({
      inventory: {
        ...base,
        groups: [{
          source: 'runtime',
          rank: 5,
          layer: 'global',
          skills: [{
            name: 'contributed',
            description: 'no file behind it',
            authored: { modelInvocable: true, userInvocable: true },
            effective: { modelInvocable: true, userInvocable: true },
            shadowed: false,
          }],
        }],
      },
    })
    expect(screen.getByRole('heading', { level: 4 }).textContent).toBe('Contributed at runtime')
    expect(screen.getByRole('switch', { name: 'Model may invoke contributed' })).toBeTruthy()
  })

  it('reflects the effective policy on both toggles and routes each change', () => {
    const actions = renderSection()
    const model = screen.getByRole('switch', { name: 'Model may invoke fixture-user-only' })
    const user = screen.getByRole('switch', { name: 'User may invoke fixture-user-only' })
    expect(model.getAttribute('aria-checked')).toBe('false')
    expect(user.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(model)
    expect(actions.setModel).toHaveBeenCalledWith('fixture-user-only', true)
    fireEvent.click(user)
    expect(actions.setUser).toHaveBeenCalledWith('fixture-user-only', false)
  })

  it('marks a stored override and offers its reset', () => {
    const actions = renderSection()
    expect(screen.getAllByText('Overridden')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Reset fixture-user-only to its authored policy' }))
    expect(actions.reset).toHaveBeenCalledWith('fixture-user-only')
  })

  it('renders a shadowed row read-only', () => {
    renderSection()
    const shadowed = screen.getByText('shadowed by a nearer definition').closest('div')!
    expect(within(shadowed).getByRole('switch', { name: 'Model may invoke fixture-demo' }).hasAttribute('disabled'))
      .toBe(true)
    expect(within(shadowed).getByRole('switch', { name: 'User may invoke fixture-demo' }).hasAttribute('disabled'))
      .toBe(true)
  })

  it('says so when discovery was incomplete', () => {
    renderSection({ inventory: inventory({ complete: false }) })
    expect(screen.getByText('A provider did not answer, so this list is partial.')).toBeTruthy()
  })

  it('disables every control on a read-only settings document', () => {
    renderSection({ writable: false })
    expect(screen.getByText('The settings document is read-only in this deployment.')).toBeTruthy()
    for (const toggle of screen.getAllByRole('switch')) expect(toggle.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Reset fixture-user-only to its authored policy' }).hasAttribute('disabled'))
      .toBe(true)
  })

  it('asks for a session before it can list anything', () => {
    renderSection({ cwd: undefined, inventory: undefined })
    expect(screen.getByText(en.noSession)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('reports a project that discovers no skills', () => {
    renderSection({ inventory: { groups: [], complete: true } })
    expect(screen.getByText('This project discovers no skills.')).toBeTruthy()
  })

  it('asks for the first read while idle and shows progress while loading', () => {
    const idle = renderSection({ status: 'idle', inventory: undefined })
    expect(idle.refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Reading the skill inventory…')).toBeTruthy()
    cleanup()

    const loading = renderSection({ status: 'loading', inventory: undefined })
    expect(loading.refresh).not.toHaveBeenCalled()
    expect(screen.getByText('Reading the skill inventory…')).toBeTruthy()
  })

  it('offers a retry after a failed read', () => {
    const actions = renderSection({ status: 'error', error: 'session-not-found: gone', inventory: undefined })
    expect(screen.getByText('Reading the skill inventory failed: session-not-found: gone')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(actions.refresh).toHaveBeenCalledTimes(1)
  })
})
