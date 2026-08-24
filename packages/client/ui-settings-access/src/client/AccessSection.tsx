/**
 * Access administration section: the account roster, the permission groups,
 * one group's membership, and the rules editor — one card per rule domain,
 * each with its posture, its rules, and a probe that answers for one name.
 *
 * The page renders nothing administrable unless the gate said this browser is
 * an administrator. That is a courtesy, not a control — the Host refuses every
 * `auth.admin.*` call from anyone else — so the empty state says so instead of
 * pretending the page does not exist.
 */

import { useState, type ReactNode } from 'react'
import type { AdminGroupView, AdminRuleView, AdminUserView } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Input, Toggle } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { domainLabel, type AccessTranslate } from './locales.ts'
import type { AccessFace, AccessState } from './access-controller.ts'
import {
  analyzeRules, CATCH_ALL_PATTERN, previewNames, probeName, type AccessDomain, type DomainAnalysis,
} from './rules.ts'
import styles from './AccessSection.module.css'

/** Injected dependencies of {@link AccessSection} (slot `inject`). */
export type AccessSectionInjected = AccessFace

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type AccessSectionProps = Partial<InjectFace<AccessSectionInjected>>

type AccessFaceProps = InjectFace<AccessSectionInjected>

/** Copy key per domain reach: the sentence under a card's badge. */
const REACH_KEYS = {
  open: 'reachOpen',
  'open-with-exceptions': 'reachOpenWithExceptions',
  allowlist: 'reachAllowlist',
  locked: 'reachLocked',
} as const

/** Badge copy per domain reach, which is the card's posture at a glance. */
const BADGE_KEYS = {
  open: 'badgeOpen',
  'open-with-exceptions': 'badgeOpenWithExceptions',
  allowlist: 'badgeAllowlist',
  locked: 'badgeLocked',
} as const

/** Copy key per probe ground, in the precedence order the Host applies. */
const PROBE_REASON_KEYS = {
  open: 'probeReasonOpen',
  deny: 'probeReasonDeny',
  allow: 'probeReasonAllow',
  unmatched: 'probeReasonUnmatched',
} as const

/**
 * Render the Access section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function AccessSection(props: AccessSectionProps): ReactNode {
  // The renderer spreads the whole inject face or none of it, so one member
  // decides for all of them; the narrowing is what the Partial type needs.
  if (props.useAccess === undefined || props.t === undefined) return null
  return <Loaded injected={props as AccessFaceProps} />
}

function Loaded({ injected }: { injected: AccessFaceProps }): ReactNode {
  const { t, refresh } = injected
  const state = injected.useAccess(snapshot => snapshot)

  if (state.status === 'idle') refresh()

  return (
    <div className={styles['section']}>
      <h3 className={styles['title']}>{t('title')}</h3>
      <p className={styles['intro']}>{t('intro')}</p>
      <Body injected={injected} state={state} />
    </div>
  )
}

/** Whichever of the four postures the snapshot is in. */
function Body({ injected, state }: { injected: AccessFaceProps; state: AccessState }): ReactNode {
  const { t, refresh } = injected
  if (state.grant === 'absent') return <p className={styles['empty']}>{t('notAuthenticating')}</p>
  if (state.grant === 'forbidden') return <p className={styles['empty']}>{t('adminOnly')}</p>
  if (state.status === 'error') {
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the optional type */
    const detail = state.error ?? ''
    return (
      <>
        <p className={styles['error']}>{`${t('loadFailed')}: ${detail}`}</p>
        <Button variant="outline" size="sm" onClick={() => { refresh() }}>{t('retry')}</Button>
      </>
    )
  }
  if (state.status !== 'ready') return <p className={styles['loading']}>{t('loading')}</p>
  return <Administration injected={injected} state={state} />
}

/** The granted, settled page. */
function Administration({ injected, state }: { injected: AccessFaceProps; state: AccessState }): ReactNode {
  const selected = state.groups.find(group => group.groupId === state.selected)
  return (
    <>
      {state.error !== undefined && <p className={styles['error']}>{`${injected.t('actionFailed')}: ${state.error}`}</p>}
      <Users injected={injected} state={state} />
      <Groups injected={injected} state={state} />
      {selected !== undefined && (
        <>
          <Members injected={injected} state={state} group={selected} />
          <Rules injected={injected} state={state} group={selected} />
        </>
      )}
    </>
  )
}

/** The account roster and the create-account form. */
function Users({ injected, state }: { injected: AccessFaceProps; state: AccessState }): ReactNode {
  const { t, createUser } = injected
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const submittable = email.length > 0 && password.length > 0 && !state.busy
  return (
    <section className={styles['panel']}>
      <h4 className={styles['panelTitle']}>{t('usersTitle')}</h4>
      <p className={styles['hint']}>{t('usersIntro')}</p>
      <div className={styles['form']}>
        <Input
          aria-label={t('newUserEmail')}
          placeholder={t('newUserEmail')}
          value={email}
          onChange={(event) => { setEmail(event.target.value) }}
        />
        <Input
          aria-label={t('newUserPassword')}
          placeholder={t('newUserPassword')}
          type="password"
          value={password}
          onChange={(event) => { setPassword(event.target.value) }}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={!submittable}
          onClick={() => { createUser(email, password); setEmail(''); setPassword('') }}
        >
          {t('createUser')}
        </Button>
      </div>
      {state.users.length === 0
        ? <p className={styles['empty']}>{t('usersEmpty')}</p>
        : (
          <ul className={styles['rows']}>
            {state.users.map(user => (
              <li key={user.userId} className={styles['row']}>
                <UserRow injected={injected} state={state} user={user} />
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

/** One account: its address, its two markers, and the block/restore button. */
function UserRow(
  { injected, state, user }: { injected: AccessFaceProps; state: AccessState; user: AdminUserView },
): ReactNode {
  const { t, setUserDisabled } = injected
  return (
    <>
      <span className={styles['name']}>{user.email}</span>
      <span className={styles['markers']}>
        {user.disabled && <span className={styles['badge']}>{t('disabledBadge')}</span>}
        {!user.emailVerified && <span className={styles['badge']}>{t('unverifiedBadge')}</span>}
      </span>
      <Button
        size="sm"
        disabled={state.busy}
        aria-label={t(user.disabled ? 'enableUser' : 'disableUser', { email: user.email })}
        onClick={() => { setUserDisabled(user.userId, !user.disabled) }}
      >
        {t(user.disabled ? 'enable' : 'disable')}
      </Button>
    </>
  )
}

/** The group list, the create-group form, and rename/delete per group. */
function Groups({ injected, state }: { injected: AccessFaceProps; state: AccessState }): ReactNode {
  const { t, createGroup } = injected
  const [name, setName] = useState('')
  return (
    <section className={styles['panel']}>
      <h4 className={styles['panelTitle']}>{t('groupsTitle')}</h4>
      <p className={styles['hint']}>{t('groupsIntro')}</p>
      <div className={styles['form']}>
        <Input
          aria-label={t('newGroupName')}
          placeholder={t('newGroupName')}
          value={name}
          onChange={(event) => { setName(event.target.value) }}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={name.length === 0 || state.busy}
          onClick={() => { createGroup(name); setName('') }}
        >
          {t('createGroup')}
        </Button>
      </div>
      <ul className={styles['rows']}>
        {state.groups.map(group => (
          <li key={group.groupId} className={styles['row']} data-selected={group.groupId === state.selected || undefined}>
            <GroupRow injected={injected} state={state} group={group} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One group row: select, rename, and — unless it is builtin — delete. */
function GroupRow(
  { injected, state, group }: { injected: AccessFaceProps; state: AccessState; group: AdminGroupView },
): ReactNode {
  const { t, selectGroup, renameGroup, deleteGroup } = injected
  const [name, setName] = useState(group.name)
  return (
    <>
      <Button
        size="sm"
        aria-label={t('selectGroup', { name: group.name })}
        onClick={() => { selectGroup(group.groupId) }}
      >
        {group.name}
      </Button>
      {group.builtin
        ? <span className={styles['badge']} title={t('builtinLocked')}>{t('builtinGroup')}</span>
        : (
          <span className={styles['markers']}>
            <Input
              aria-label={t('renameGroup', { name: group.name })}
              value={name}
              onChange={(event) => { setName(event.target.value) }}
            />
            <Button
              size="sm"
              disabled={name.length === 0 || name === group.name || state.busy}
              onClick={() => { renameGroup(group.groupId, name) }}
            >
              {t('rename')}
            </Button>
            <Button
              size="sm"
              disabled={state.busy}
              aria-label={t('deleteGroup', { name: group.name })}
              onClick={() => { deleteGroup(group.groupId) }}
            >
              {t('delete')}
            </Button>
          </span>
        )}
    </>
  )
}

/** One tick per account: whether it belongs to the selected group. */
function Members(
  { injected, state, group }: { injected: AccessFaceProps; state: AccessState; group: AdminGroupView },
): ReactNode {
  const { t, setMember } = injected
  return (
    <section className={styles['panel']}>
      <h4 className={styles['panelTitle']}>{t('membersTitle')}</h4>
      <p className={styles['hint']}>{t('membersIntro', { name: group.name })}</p>
      <ul className={styles['rows']}>
        {state.users.map(user => (
          <li key={user.userId} className={styles['row']}>
            <Toggle
              checked={group.members.includes(user.userId)}
              disabled={state.busy}
              label={user.email}
              aria-label={t('memberToggle', { email: user.email, name: group.name })}
              onChange={(next) => { setMember(group.groupId, user.userId, next) }}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The rules editor: one card per domain, the save bar, and the catalog preview. */
function Rules(
  { injected, state, group }: { injected: AccessFaceProps; state: AccessState; group: AdminGroupView },
): ReactNode {
  const { t, saveRules, discardRules } = injected
  return (
    <section className={styles['panel']}>
      <h4 className={styles['panelTitle']}>{t('rulesTitle')}</h4>
      <p className={styles['hint']}>{t('rulesIntro')}</p>
      <div className={styles['domains']}>
        {analyzeRules(state.draft).map(analysis => (
          <DomainCard key={analysis.domain} injected={injected} state={state} group={group} analysis={analysis} />
        ))}
      </div>
      {state.dirty && (
        <div className={styles['form']}>
          <p className={styles['notice']}>{t('unsaved')}</p>
          <Button variant="primary" size="sm" disabled={state.busy} onClick={() => { saveRules() }}>
            {t('saveRules')}
          </Button>
          <Button size="sm" disabled={state.busy} onClick={() => { discardRules() }}>
            {t('discardRules')}
          </Button>
        </div>
      )}
      <Preview state={state} name={group.name} t={t} />
    </section>
  )
}

/**
 * One domain: its posture, its rules, whatever it earned a warning for, the
 * form that writes another rule into it, and the probe that answers for a name.
 *
 * The card is the explanation. A domain nobody addressed renders quiet and
 * empty, and writing its first rule changes the badge, the line under it, and
 * every probe answer in front of the administrator who wrote it.
 */
function DomainCard(
  { injected, state, group, analysis }: {
    injected: AccessFaceProps
    state: AccessState
    group: AdminGroupView
    analysis: DomainAnalysis
  },
): ReactNode {
  const { t, addDraftRule } = injected
  const { domain, reach } = analysis
  const [pattern, setPattern] = useState('')
  const [effect, setEffect] = useState<AdminRuleView['effect']>('deny')
  const label = domainLabel(domain, t)
  const entries = state.draft
    .map((rule, index) => ({ rule, index }))
    .filter(entry => entry.rule.domain === domain)
  return (
    <section className={styles['card']} data-reach={reach} aria-label={label}>
      <div className={styles['cardHeader']}>
        <h5 className={styles['cardTitle']}>{label}</h5>
        <span className={styles['posture']} data-reach={reach}>{t(BADGE_KEYS[reach])}</span>
      </div>
      <p className={styles['reach']}>{t(REACH_KEYS[reach])}</p>
      {entries.length > 0 && (
        <ul className={styles['chips']}>
          {entries.map(entry => (
            <li key={`${entry.rule.effect}:${entry.rule.pattern}`}>
              <RuleChip injected={injected} rule={entry.rule} index={entry.index} busy={state.busy} />
            </li>
          ))}
        </ul>
      )}
      {analysis.warn && (
        <p className={styles['cardWarning']} role="alert">
          {t(reach === 'locked' ? 'warnLocked' : 'warnAllowlist', { name: group.name })}
        </p>
      )}
      {state.seededDomain === domain && (
        <p className={styles['notice']}>{t('seeded', { pattern: CATCH_ALL_PATTERN })}</p>
      )}
      <div className={styles['form']}>
        <select
          className={styles['select']}
          aria-label={t('ruleEffect', { domain: label })}
          value={effect}
          onChange={(event) => { setEffect(event.target.value as AdminRuleView['effect']) }}
        >
          <option value="allow">{t('effectAllow')}</option>
          <option value="deny">{t('effectDeny')}</option>
        </select>
        <span className={styles['field']}>
          <Input
            aria-label={t('rulePattern', { domain: label })}
            placeholder={t('patternPlaceholder')}
            value={pattern}
            onChange={(event) => { setPattern(event.target.value) }}
          />
        </span>
        <Button
          variant="primary"
          size="sm"
          disabled={pattern.length === 0 || state.busy}
          aria-label={t('addRuleTo', { domain: label })}
          onClick={() => { addDraftRule(domain, pattern, effect); setPattern('') }}
        >
          {t('addRule')}
        </Button>
      </div>
      <Probe domain={domain} label={label} draft={state.draft} t={t} />
    </section>
  )
}

/** One draft rule, removable in place; a denial is the loud chip because deny wins. */
function RuleChip(
  { injected, rule, index, busy }: {
    injected: AccessFaceProps
    rule: AdminRuleView
    index: number
    busy: boolean
  },
): ReactNode {
  const { t, removeDraftRule } = injected
  const effect = t(rule.effect === 'allow' ? 'effectAllow' : 'effectDeny')
  return (
    <span className={styles['chip']} data-effect={rule.effect}>
      <span className={styles['chipEffect']}>{effect}</span>
      <span className={styles['chipPattern']}>{rule.pattern}</span>
      <button
        type="button"
        className={styles['chipRemove']}
        disabled={busy}
        aria-label={t('removeRule', { effect, domain: domainLabel(rule.domain, t), pattern: rule.pattern })}
        onClick={() => { removeDraftRule(index) }}
      >
        ×
      </button>
    </span>
  )
}

/**
 * Try one name against the draft, and say which rule decided it.
 *
 * This is where precedence is stated, because here it is demonstrated: a name
 * two rules match answers with the denial, and a governed domain answers a name
 * nothing matches with a refusal.
 */
function Probe(
  { domain, label, draft, t }: {
    domain: AccessDomain
    label: string
    draft: readonly AdminRuleView[]
    t: AccessTranslate
  },
): ReactNode {
  const [name, setName] = useState('')
  const verdict = name.length === 0 ? undefined : probeName(draft, domain, name)
  return (
    <div className={styles['probe']}>
      <div className={styles['probeRow']}>
        <span className={styles['field']}>
          <Input
            aria-label={t('probeField', { domain: label })}
            placeholder={t('probePlaceholder')}
            value={name}
            onChange={(event) => { setName(event.target.value) }}
          />
        </span>
        {verdict !== undefined && (
          <span className={styles['verdict']} data-permitted={verdict.permitted}>
            {t(verdict.permitted ? 'probeAllowed' : 'probeRefused')}
          </span>
        )}
      </div>
      <p className={styles['reach']}>
        {verdict === undefined
          ? t('probeHint')
          : t(PROBE_REASON_KEYS[verdict.ground], { pattern: verdict.pattern })}
      </p>
    </div>
  )
}

/** What a member would see of the one catalog the page can resolve by name. */
function Preview(
  { state, name, t }: { state: AccessState; name: string; t: AccessTranslate },
): ReactNode {
  return (
    <div className={styles['preview']}>
      <h5 className={styles['panelTitle']}>{t('previewTitle')}</h5>
      <p className={styles['hint']}>{t('previewIntro', { name })}</p>
      <SkillPreview state={state} t={t} />
    </div>
  )
}

/** The `skill` domain resolved against the catalog the Host actually discovered. */
function SkillPreview({ state, t }: { state: AccessState; t: AccessTranslate }): ReactNode {
  if (state.skills === undefined) return <p className={styles['hint']}>{t('previewNoSession')}</p>
  if (state.skills.length === 0) return <p className={styles['hint']}>{t('previewSkillsEmpty')}</p>
  const { visible, hidden } = previewNames(state.draft, 'skill', state.skills)
  return (
    <>
      <p className={styles['hint']}>{t('previewVisible', { count: visible.length, names: visible.join(', ') })}</p>
      {hidden.length === 0
        ? <p className={styles['hint']}>{t('previewNoneHidden')}</p>
        : <p className={styles['warning']}>{t('previewHidden', { count: hidden.length, names: hidden.join(', ') })}</p>}
    </>
  )
}
