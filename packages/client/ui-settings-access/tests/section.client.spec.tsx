// @vitest-environment jsdom
/**
 * What the Access section shows: the two explained empty states, the roster and
 * group lists, the builtin group's missing delete control, and the rules editor
 * — four domain cards that change posture as rules land on them, the probe that
 * answers one name against the draft, and the catalog preview that already
 * counts unsaved rules.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
    seededDomain: undefined,
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
  return { ...actions, store }
}

/** One domain's card, which is a landmark named by the domain it governs. */
const card = (domain: string): HTMLElement => screen.getByRole('region', { name: domain })

/** Rewrite the draft the way the controller would, and let the cards follow. */
function setDraft(store: ReturnType<typeof renderSection>['store'], draft: readonly AdminRuleView[]): void {
  act(() => { store.update((state) => { state.draft = draft }) })
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
  it('renders one card per domain, whether or not anything governs it', () => {
    renderSection({ selected: TEAM_GROUP, draft: [denySecret, allowEverything] })
    for (const domain of ['Skills', 'Tools', 'Models', 'Settings namespaces']) {
      expect(card(domain)).toBeTruthy()
    }
  })

  it('reads a domain no rule addresses as open and leaves its card empty', () => {
    renderSection({ selected: TEAM_GROUP })
    const models = card('Models')
    expect(within(models).getByText(en.badgeOpen)).toBeTruthy()
    expect(within(models).getByText(en.reachOpen)).toBeTruthy()
    expect(within(models).queryByRole('listitem')).toBeNull()
  })

  it('flips a card from open to allowlist as its first rule lands', () => {
    const { store } = renderSection({ selected: TEAM_GROUP })
    expect(within(card('Tools')).getByText(en.badgeOpen)).toBeTruthy()
    setDraft(store, [{ domain: 'tool', pattern: 'bash', effect: 'allow' }])
    expect(within(card('Tools')).getByText(en.badgeAllowlist)).toBeTruthy()
    expect(within(card('Tools')).getByText(en.reachAllowlist)).toBeTruthy()
    // The other three are untouched: reach is decided per domain.
    expect(within(card('Models')).getByText(en.badgeOpen)).toBeTruthy()
  })

  it('flips to open-with-exceptions when a seeded catch-all stands beside the denial', () => {
    const { store } = renderSection({ selected: TEAM_GROUP })
    setDraft(store, [allowEverything, denySecret])
    expect(within(card('Skills')).getByText(en.badgeOpenWithExceptions)).toBeTruthy()
    expect(within(card('Skills')).getByText(en.reachOpenWithExceptions)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('restores the open state when the last rule of a domain is removed', () => {
    const { store } = renderSection({ selected: TEAM_GROUP, draft: [denySecret] })
    expect(within(card('Skills')).getByText(en.badgeLocked)).toBeTruthy()
    setDraft(store, [])
    expect(within(card('Skills')).getByText(en.badgeOpen)).toBeTruthy()
    expect(within(card('Skills')).getByText(en.reachOpen)).toBeTruthy()
  })

  it('marks a deny-only domain locked and warns on that card, not somewhere else', () => {
    renderSection({ selected: TEAM_GROUP, draft: [denySecret], dirty: true })
    const skills = card('Skills')
    expect(within(skills).getByText(en.badgeLocked)).toBeTruthy()
    expect(within(skills).getByText(en.reachLocked)).toBeTruthy()
    expect(within(skills).getByRole('alert').textContent)
      .toBe('Members of team lose everything in this domain.')
    expect(within(card('Tools')).queryByRole('alert')).toBeNull()
  })

  it('warns more quietly on a domain narrowed to explicit allows', () => {
    renderSection({ selected: TEAM_GROUP, draft: [{ domain: 'skill', pattern: 'alpha', effect: 'allow' }] })
    expect(within(card('Skills')).getByRole('alert').textContent)
      .toBe('Every other name in this domain is refused.')
  })

  it('anchors the seeding notice to the domain the seeding happened in', () => {
    renderSection({
      selected: TEAM_GROUP,
      draft: [allowEverything, denySecret],
      dirty: true,
      seededDomain: 'skill',
    })
    expect(within(card('Skills')).getByText(t('seeded', { pattern: '*' }))).toBeTruthy()
    expect(within(card('Tools')).queryByText(t('seeded', { pattern: '*' }))).toBeNull()
  })

  it('adds a rule from the card of the domain it belongs to', () => {
    const actions = renderSection({ selected: TEAM_GROUP })
    const tools = card('Tools')
    const add = within(tools).getByRole<HTMLButtonElement>('button', { name: 'Add rule to Tools' })
    expect(add.disabled).toBe(true)
    fireEvent.change(within(tools).getByLabelText('Tools: effect'), { target: { value: 'allow' } })
    fireEvent.change(within(tools).getByLabelText('Tools: name, or a prefix ending in *'), {
      target: { value: 'bash' },
    })
    fireEvent.click(add)
    expect(actions.addDraftRule).toHaveBeenCalledWith('tool', 'bash', 'allow')
    expect(within(tools).getByLabelText<HTMLInputElement>('Tools: name, or a prefix ending in *').value).toBe('')
  })

  it('shows each rule as a chip in its own card and removes one by draft position', () => {
    const actions = renderSection({
      selected: TEAM_GROUP,
      draft: [allowEverything, denySecret, { domain: 'tool', pattern: 'bash', effect: 'allow' }],
      dirty: true,
    })
    const skills = card('Skills')
    expect(within(skills).getAllByRole('listitem')).toHaveLength(2)
    expect(within(skills).getByText('secret')).toBeTruthy()
    expect(within(card('Tools')).getByText('bash')).toBeTruthy()
    fireEvent.click(within(skills).getByRole('button', { name: 'Remove rule: Deny Skills secret' }))
    expect(actions.removeDraftRule).toHaveBeenCalledWith(1)
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
})

describe('the per-domain probe', () => {
  /** Type one candidate name into one domain's probe. */
  function probe(domain: string, name: string): HTMLElement {
    const owner = card(domain)
    fireEvent.change(within(owner).getByLabelText(`${domain}: try a name`), { target: { value: name } })
    return owner
  }

  it('waits for a name and says what typing one buys', () => {
    renderSection({ selected: TEAM_GROUP, draft: [denySecret] })
    const skills = card('Skills')
    expect(within(skills).getByText(en.probeHint)).toBeTruthy()
    expect(within(skills).queryByText(en.probeRefused)).toBeNull()
  })

  it('grants every name while the domain is ungoverned', () => {
    renderSection({ selected: TEAM_GROUP })
    const models = probe('Models', 'deepseek/deepseek-chat')
    expect(within(models).getByText(en.probeAllowed)).toBeTruthy()
    expect(within(models).getByText(en.probeReasonOpen)).toBeTruthy()
  })

  it('answers a denied name with the denial, saying deny beats allow', () => {
    renderSection({ selected: TEAM_GROUP, draft: [allowEverything, denySecret] })
    const skills = probe('Skills', 'secret')
    expect(within(skills).getByText(en.probeRefused)).toBeTruthy()
    expect(within(skills).getByText('Denied by secret: deny beats allow.')).toBeTruthy()
  })

  it('answers a name a prefix covers with the allow that covered it', () => {
    renderSection({ selected: TEAM_GROUP, draft: [{ domain: 'tool', pattern: 'web_*', effect: 'allow' }] })
    const tools = probe('Tools', 'web_search')
    expect(within(tools).getByText(en.probeAllowed)).toBeTruthy()
    expect(within(tools).getByText('Granted by web_*, and no denial matched.')).toBeTruthy()
  })

  it('refuses an unmatched name once the domain is an allowlist', () => {
    renderSection({ selected: TEAM_GROUP, draft: [{ domain: 'skill', pattern: 'alpha', effect: 'allow' }] })
    const skills = probe('Skills', 'secret')
    expect(within(skills).getByText(en.probeRefused)).toBeTruthy()
    expect(within(skills).getByText(en.probeReasonUnmatched)).toBeTruthy()
  })

  it('answers from the draft, so an unsaved rule changes the verdict under the typed name', () => {
    const { store } = renderSection({ selected: TEAM_GROUP })
    const skills = probe('Skills', 'secret')
    expect(within(skills).getByText(en.probeAllowed)).toBeTruthy()
    setDraft(store, [allowEverything, denySecret])
    expect(within(card('Skills')).getByText(en.probeRefused)).toBeTruthy()
  })

  it('keeps each domain’s probe to its own rules', () => {
    renderSection({ selected: TEAM_GROUP, draft: [denySecret] })
    expect(within(probe('Skills', 'alpha')).getByText(en.probeRefused)).toBeTruthy()
    expect(within(probe('Tools', 'alpha')).getByText(en.probeAllowed)).toBeTruthy()
  })
})

describe('the catalog preview', () => {
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
