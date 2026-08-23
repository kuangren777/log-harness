// @vitest-environment jsdom
/**
 * What the Access section shows: the two explained empty states, the roster and
 * group lists, the builtin group's missing delete control, and the rules editor
 * — its seeding notice, its lockout warning, and the preview that already
 * counts unsaved rules.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { AdminGroupView, AdminRuleView, AdminUserView, GroupId, UserId } from '@deepseek-ai/dsh-api-remotes/client'
import { AccessSection, type AccessSectionProps } from '../src/client/AccessSection.tsx'
import type { AccessState } from '../src/client/access-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en, params?: Record<string, string>): string =>
  en[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)

const ADMIN_GROUP = 'admin' as GroupId
const TEAM_GROUP = 'group-2' as GroupId
const ADA = 'user-1' as UserId
const BEN = 'user-2' as UserId

const denySecret: AdminRuleView = { domain: 'skill', pattern: 'secret', effect: 'deny' }
const allowEverything: AdminRuleView = { domain: 'skill', pattern: '*', effect: 'allow' }

function user(userId: UserId, email: string, extra: Partial<AdminUserView> = {}): AdminUserView {
  return { userId, email, emailVerified: true, disabled: false, createdAt: 0, ...extra }
}

function group(groupId: GroupId, name: string, extra: Partial<AdminGroupView> = {}): AdminGroupView {
  return { groupId, name, builtin: false, createdAt: 0, members: [], rules: [], ...extra }
}

function renderSection(state: Partial<AccessState> = {}) {
  const store = createSnapshotStore<AccessState>({
    status: 'ready',
    grant: 'granted',
    users: [user(ADA, 'ada@example.test'), user(BEN, 'ben@example.test')],
    groups: [group(ADMIN_GROUP, 'admin', { builtin: true, members: [ADA] }), group(TEAM_GROUP, 'team')],
    selected: undefined,
    draft: [],
    dirty: false,
    seeded: false,
    skills: ['alpha', 'secret'],
    error: undefined,
    busy: false,
    ...state,
  })
  const actions = {
    refresh: vi.fn(),
    createUser: vi.fn(),
    setUserDisabled: vi.fn(),
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    deleteGroup: vi.fn(),
    selectGroup: vi.fn(),
    setMember: vi.fn(),
    addDraftRule: vi.fn(),
    removeDraftRule: vi.fn(),
    saveRules: vi.fn(),
    discardRules: vi.fn(),
  }
  const props = { ...actions, t, useAccess: bindSnapshotSelector(store) } as unknown as AccessSectionProps
  render(<AccessSection {...props} />)
  return actions
}

describe('AccessSection postures', () => {
  it('renders null until the shell injects the section dependencies', () => {
    expect(AccessSection({})).toBeNull()
  })

  it('says nothing is administrable when no request gate answered', () => {
    renderSection({ grant: 'absent' })
    expect(screen.getByText(en.notAuthenticating)).toBeTruthy()
    expect(screen.queryByText(en.usersTitle)).toBeNull()
  })

  it('explains that the server, not the page, is what refuses a non-administrator', () => {
    renderSection({ grant: 'forbidden' })
    expect(screen.getByText(en.adminOnly)).toBeTruthy()
    expect(screen.queryByLabelText(en.newUserEmail)).toBeNull()
  })

  it('asks the controller to load itself the first time it renders', () => {
    const actions = renderSection({ status: 'idle', grant: 'unknown' })
    expect(actions.refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByText(en.loading)).toBeTruthy()
  })

  it('reports a load failure with a retry', () => {
    const actions = renderSection({ status: 'error', error: 'forbidden: no' })
    expect(screen.getByText('Reading failed: forbidden: no')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(actions.refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps a settled page mounted and shows the failure of the last action', () => {
    renderSection({ error: 'duplicate-group-name: team exists' })
    expect(screen.getByText('The operation failed: duplicate-group-name: team exists')).toBeTruthy()
    expect(screen.getByText(en.usersTitle)).toBeTruthy()
  })
})

describe('accounts', () => {
  it('creates an account from the two fields and clears them', () => {
    const actions = renderSection()
    fireEvent.change(screen.getByLabelText(en.newUserEmail), { target: { value: 'cleo@example.test' } })
    fireEvent.change(screen.getByLabelText(en.newUserPassword), { target: { value: 'correct-horse' } })
    fireEvent.click(screen.getByRole('button', { name: en.createUser }))
    expect(actions.createUser).toHaveBeenCalledWith('cleo@example.test', 'correct-horse')
    expect(screen.getByLabelText<HTMLInputElement>(en.newUserEmail).value).toBe('')
  })

  it('refuses to submit an incomplete account form', () => {
    renderSection()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.createUser }).disabled).toBe(true)
  })

  it('blocks an account and restores a blocked one', () => {
    const actions = renderSection({
      users: [user(ADA, 'ada@example.test'), user(BEN, 'ben@example.test', { disabled: true, emailVerified: false })],
    })
    expect(screen.getByText(en.disabledBadge)).toBeTruthy()
    expect(screen.getByText(en.unverifiedBadge)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Disable ada@example.test' }))
    expect(actions.setUserDisabled).toHaveBeenCalledWith(ADA, true)
    fireEvent.click(screen.getByRole('button', { name: 'Restore ben@example.test' }))
    expect(actions.setUserDisabled).toHaveBeenLastCalledWith(BEN, false)
  })

  it('says so when there is no account yet', () => {
    renderSection({ users: [] })
    expect(screen.getByText(en.usersEmpty)).toBeTruthy()
  })
})

describe('groups', () => {
  it('creates a group from the name field', () => {
    const actions = renderSection()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.createGroup }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(en.newGroupName), { target: { value: 'squad' } })
    fireEvent.click(screen.getByRole('button', { name: en.createGroup }))
    expect(actions.createGroup).toHaveBeenCalledWith('squad')
  })

  it('offers neither rename nor delete for the builtin administrator group', () => {
    renderSection()
    expect(screen.queryByRole('button', { name: 'Delete admin' })).toBeNull()
    expect(screen.queryByLabelText('Rename admin')).toBeNull()
    expect(screen.getByText(en.builtinGroup)).toBeTruthy()
    // The ordinary group beside it carries both.
    expect(screen.getByRole('button', { name: 'Delete team' })).toBeTruthy()
  })

  it('selects, renames, and deletes an ordinary group', () => {
    const actions = renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Edit team' }))
    expect(actions.selectGroup).toHaveBeenCalledWith(TEAM_GROUP)
    const rename = screen.getByLabelText('Rename team')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.rename }).disabled).toBe(true)
    fireEvent.change(rename, { target: { value: 'squad' } })
    fireEvent.click(screen.getByRole('button', { name: en.rename }))
    expect(actions.renameGroup).toHaveBeenCalledWith(TEAM_GROUP, 'squad')
    fireEvent.click(screen.getByRole('button', { name: 'Delete team' }))
    expect(actions.deleteGroup).toHaveBeenCalledWith(TEAM_GROUP)
  })

  it('shows membership and rules only for the selected group', () => {
    renderSection()
    expect(screen.queryByText(en.membersTitle)).toBeNull()
    cleanup()
    renderSection({ selected: TEAM_GROUP })
    expect(screen.getByText(en.membersTitle)).toBeTruthy()
    expect(screen.getByText(en.rulesTitle)).toBeTruthy()
  })

  it('moves one account in and out of the selected group', () => {
    const actions = renderSection({ selected: TEAM_GROUP, groups: [group(TEAM_GROUP, 'team', { members: [ADA] })] })
    fireEvent.click(screen.getByRole('switch', { name: 'ben@example.test belongs to team' }))
    expect(actions.setMember).toHaveBeenCalledWith(TEAM_GROUP, BEN, true)
    fireEvent.click(screen.getByRole('switch', { name: 'ada@example.test belongs to team' }))
    expect(actions.setMember).toHaveBeenLastCalledWith(TEAM_GROUP, ADA, false)
  })
})

describe('the rules editor', () => {
  it('adds a rule from the domain, effect, and pattern controls', () => {
    const actions = renderSection({ selected: TEAM_GROUP })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.addRule }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(en.ruleDomain), { target: { value: 'tool' } })
    fireEvent.change(screen.getByLabelText(en.ruleEffect), { target: { value: 'allow' } })
    fireEvent.change(screen.getByLabelText(en.rulePattern), { target: { value: 'bash' } })
    fireEvent.click(screen.getByRole('button', { name: en.addRule }))
    expect(actions.addDraftRule).toHaveBeenCalledWith('tool', 'bash', 'allow')
  })

  it('lists the draft rules and removes one by position', () => {
    const actions = renderSection({ selected: TEAM_GROUP, draft: [allowEverything, denySecret], dirty: true })
    expect(screen.getByText('Allow · Skills · *')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule: Deny Skills secret' }))
    expect(actions.removeDraftRule).toHaveBeenCalledWith(1)
  })

  it('says when it seeded a catch-all beside the first denial', () => {
    renderSection({ selected: TEAM_GROUP, draft: [allowEverything, denySecret], dirty: true, seeded: true })
    expect(screen.getByText(t('seeded', { pattern: '*' }))).toBeTruthy()
  })

  it('offers save and discard only while the draft differs from what is stored', () => {
    const actions = renderSection({ selected: TEAM_GROUP, draft: [denySecret], dirty: true })
    expect(screen.getByText(en.unsaved)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.saveRules }))
    fireEvent.click(screen.getByRole('button', { name: en.discardRules }))
    expect(actions.saveRules).toHaveBeenCalledTimes(1)
    expect(actions.discardRules).toHaveBeenCalledTimes(1)
    cleanup()
    renderSection({ selected: TEAM_GROUP, draft: [denySecret] })
    expect(screen.queryByRole('button', { name: en.saveRules })).toBeNull()
  })

  it('warns that a deny-only domain takes everything, and stops once a catch-all allow exists', () => {
    renderSection({ selected: TEAM_GROUP, draft: [denySecret], dirty: true })
    expect(screen.getByRole('alert').textContent)
      .toBe('Skills: these rules admit no name at all. Members of team lose everything in this domain.')
    cleanup()
    renderSection({ selected: TEAM_GROUP, draft: [allowEverything, denySecret], dirty: true })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('warns that an explicit allowlist refuses everything it does not name', () => {
    renderSection({ selected: TEAM_GROUP, draft: [{ domain: 'skill', pattern: 'alpha', effect: 'allow' }] })
    expect(screen.getByRole('alert').textContent)
      .toBe('Skills: only the listed allow rules apply, and every other name in this domain is refused.')
  })

  it('states every domain’s reach, governed or open', () => {
    renderSection({
      selected: TEAM_GROUP,
      draft: [allowEverything, denySecret, { domain: 'tool', pattern: 'bash', effect: 'allow' }],
    })
    expect(screen.getByText('Skills: open except for the written denials.')).toBeTruthy()
    expect(screen.getByText('Tools: allowlist, limited to the written allows.')).toBeTruthy()
    expect(screen.getByText('Models: no rules, fully open.')).toBeTruthy()
    expect(screen.getByText('Settings namespaces: no rules, fully open.')).toBeTruthy()
  })

  it('states a locked domain’s reach in the preview too', () => {
    renderSection({ selected: TEAM_GROUP, draft: [denySecret] })
    expect(screen.getByText('Skills: everything refused.')).toBeTruthy()
  })
})

describe('the preview', () => {
  it('resolves the real skill catalog against rules that are not saved yet', () => {
    renderSection({ selected: TEAM_GROUP, draft: [allowEverything, denySecret], dirty: true })
    expect(screen.getByText('Skills visible (1): alpha')).toBeTruthy()
    expect(screen.getByText('Skills refused (1): secret')).toBeTruthy()
  })

  it('shows the whole catalog and no refusal while the domain is ungoverned', () => {
    renderSection({ selected: TEAM_GROUP })
    expect(screen.getByText('Skills visible (2): alpha, secret')).toBeTruthy()
    expect(screen.getByText(en.previewNoneHidden)).toBeTruthy()
  })

  it('explains that a session is needed before it can name real skills', () => {
    renderSection({ selected: TEAM_GROUP, skills: undefined })
    expect(screen.getByText(en.previewNoSession)).toBeTruthy()
  })

  it('says so when the project discovers no skill at all', () => {
    renderSection({ selected: TEAM_GROUP, skills: [] })
    expect(screen.getByText(en.previewSkillsEmpty)).toBeTruthy()
  })

  it('names the group it is answering for', () => {
    renderSection({ selected: TEAM_GROUP })
    expect(screen.getByText(t('previewIntro', { name: 'team' }))).toBeTruthy()
  })
})

describe('while a call is in flight', () => {
  it('disables every write control', () => {
    renderSection({ selected: TEAM_GROUP, draft: [denySecret], dirty: true, busy: true })
    const disabled = (name: string): boolean =>
      screen.getByRole<HTMLButtonElement>('button', { name }).disabled
    expect(disabled('Disable ada@example.test')).toBe(true)
    expect(disabled('Delete team')).toBe(true)
    expect(disabled(en.saveRules)).toBe(true)
    expect(disabled('Remove rule: Deny Skills secret')).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('switch', { name: 'ada@example.test belongs to team' }).disabled)
      .toBe(true)
  })
})
