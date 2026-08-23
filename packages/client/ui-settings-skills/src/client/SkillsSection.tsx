/**
 * Skills settings section: every skill the current session's project
 * discovers, grouped nearest-first by origin, with the two invocation surfaces
 * each skill exposes. A toggle stores one override in the `skills` settings
 * namespace and the page re-reads the inventory, so a row always shows the
 * policy the Host resolved rather than an optimistic guess. Shadowed losers
 * render read-only: a nearer definition already claimed the name, so an
 * override on this copy would address nothing.
 */

import type { ReactNode } from 'react'
import type { SkillInventoryEntry, SkillInventoryGroup } from '@deepseek-ai/dsh-api-remotes/client'
import { abbreviateHomePath } from '@deepseek-ai/dsh-client-runtime/client'
import { Toggle } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { sourceLabel } from './locales.ts'
import type { SkillsSectionFace, SkillsSectionState } from './skills-controller.ts'
import styles from './SkillsSection.module.css'

/** Injected dependencies of {@link SkillsSection} (slot `inject`). */
export type SkillsSectionInjected = SkillsSectionFace

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type SkillsSectionProps = Partial<InjectFace<SkillsSectionInjected>>

type SkillsSectionFaceProps = InjectFace<SkillsSectionInjected>

/** Stable list key for one origin group; display names are not identities. */
function groupKey(group: SkillInventoryGroup): string {
  return `${group.layer}:${group.rank}:${group.source}:${group.root ?? ''}`
}

/**
 * Render the Skills section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function SkillsSection(props: SkillsSectionProps): ReactNode {
  const { useSkills, refresh, setModel, setUser, reset, t } = props
  if (
    useSkills === undefined || refresh === undefined || setModel === undefined
    || setUser === undefined || reset === undefined || t === undefined
  ) return null
  return <Loaded injected={{ useSkills, refresh, setModel, setUser, reset, t }} />
}

function Loaded({ injected }: { injected: SkillsSectionFaceProps }): ReactNode {
  const { refresh, t } = injected
  const state = injected.useSkills(snapshot => snapshot)

  if (state.status === 'idle') refresh()

  const header = (
    <>
      <h3 className={styles['title']}>{t('title')}</h3>
      <p className={styles['intro']}>{t('intro')}</p>
      {state.cwd !== undefined && (
        <p className={styles['scope']}>{t('scope', { cwd: abbreviateHomePath(state.cwd, state.home) })}</p>
      )}
    </>
  )

  if (state.status === 'error') {
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the optional type */
    const errorText = state.error ?? ''
    return (
      <div className={styles['section']}>
        {header}
        <p className={styles['error']}>{`${t('loadFailed')}: ${errorText}`}</p>
        <button type="button" className={styles['retry']} onClick={() => { refresh() }}>{t('retry')}</button>
      </div>
    )
  }

  if (state.status !== 'ready') {
    return (
      <div className={styles['section']}>
        {header}
        <p className={styles['loading']}>{t('loading')}</p>
      </div>
    )
  }

  return (
    <div className={styles['section']}>
      {header}
      {state.inventory === undefined
        ? <p className={styles['empty']}>{t('noSession')}</p>
        : <Inventory injected={injected} state={state} />}
    </div>
  )
}

/** The settled inventory body: notices first, then the origin groups. */
function Inventory(
  { injected, state }: { injected: SkillsSectionFaceProps; state: SkillsSectionState },
): ReactNode {
  const { t } = injected
  /* v8 ignore next -- Inventory only renders with an inventory in the snapshot */
  const inventory = state.inventory ?? { groups: [], complete: true }
  return (
    <>
      {!inventory.complete && <p className={styles['notice']}>{t('incomplete')}</p>}
      {!state.writable && <p className={styles['notice']}>{t('readOnly')}</p>}
      {inventory.groups.length === 0
        ? <p className={styles['empty']}>{t('empty')}</p>
        : (
          <ul className={styles['groups']}>
            {inventory.groups.map(group => (
              <li key={groupKey(group)}>
                <h4 className={styles['groupTitle']}>{sourceLabel(group.source, t)}</h4>
                {group.root !== undefined && (
                  <p className={styles['groupRoot']}>{abbreviateHomePath(group.root, state.home)}</p>
                )}
                <ul className={styles['rows']}>
                  {group.skills.map(entry => (
                    <li key={entry.path ?? entry.name}>
                      <SkillRow entry={entry} injected={injected} writable={state.writable} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
    </>
  )
}

/** One discovered skill: identity, its override marker, and the two surfaces. */
function SkillRow(
  { entry, injected, writable }: { entry: SkillInventoryEntry; injected: SkillsSectionFaceProps; writable: boolean },
): ReactNode {
  const { setModel, setUser, reset, t } = injected
  // Presence in the stored section — not a value comparison — is what marks a
  // skill overridden, matching how every other settings surface reads the user
  // layer, and it is exactly what Reset clears.
  const overridden = entry.override !== undefined
  const locked = entry.shadowed || !writable
  return (
    <div className={styles['row']} data-shadowed={entry.shadowed ? 'true' : undefined}>
      <span className={styles['identity']}>
        <span className={styles['name']}>{entry.name}</span>
        <span className={styles['description']} title={entry.description}>{entry.description}</span>
      </span>
      <span className={styles['markers']}>
        {entry.shadowed && <span className={styles['shadowed']}>{t('shadowed')}</span>}
        {overridden && <span className={styles['badge']}>{t('overridden')}</span>}
        {overridden && (
          <button
            type="button"
            className={styles['reset']}
            disabled={locked}
            aria-label={t('resetSkill', { name: entry.name })}
            onClick={() => { reset(entry.name) }}
          >
            {t('reset')}
          </button>
        )}
      </span>
      <span className={styles['controls']}>
        <Toggle
          checked={entry.effective.modelInvocable}
          disabled={locked}
          label={t('model')}
          aria-label={t('modelToggle', { name: entry.name })}
          onChange={(next) => { setModel(entry.name, next) }}
        />
        <Toggle
          checked={entry.effective.userInvocable}
          disabled={locked}
          label={t('user')}
          aria-label={t('userToggle', { name: entry.name })}
          onChange={(next) => { setUser(entry.name, next) }}
        />
      </span>
    </div>
  )
}
