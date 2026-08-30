/**
 * The pool's left column: the whole pool, the user's groups, the quarantine
 * bucket, and the inline input that creates one more group.
 *
 * Every count is derived from the same citation list the right column draws,
 * so a number here and an empty list there cannot disagree. Deleting a group
 * asks first — the citations survive it (the host returns them to
 * `ungrouped`), but the grouping does not.
 */
import { useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { Citation, CitationGroup } from './contract.ts'
import type { SciCitationsKey } from './locales.ts'
import { CloseGlyph, PlusGlyph } from './icons.tsx'
import { ALL_GROUP, QUARANTINE_GROUP, selectionCount } from './pool-view.ts'
import css from './GroupColumn.module.css'

/** Glyph edge length inside the column's small buttons, in CSS pixels. */
const GLYPH_SIZE = 12

/** Owner-controlled props of the group column. */
export interface GroupColumnProps {
  /** The project's groups, in the host's order. */
  groups: readonly CitationGroup[]
  /** The project's citations, for the counts. */
  citations: readonly Citation[]
  /** The current left-column selection. */
  selection: string
  /** Whether a write is in flight, which freezes every gesture here. */
  disabled: boolean
  /** Select one bucket. */
  onSelect: (key: string) => void
  /** Create one group from the label the user typed. */
  onCreate: (label: string) => void
  /** Delete one group by key. */
  onDelete: (key: string) => void
  /** Localized column copy. */
  t: Translate<SciCitationsKey>
}

/**
 * Render the group column.
 * @param props - owner-controlled column props.
 * @returns the column.
 */
export function GroupColumn({
  groups, citations, selection, disabled, onSelect, onCreate, onDelete, t,
}: GroupColumnProps) {
  const [drafting, setDrafting] = useState(false)
  const [draft, setDraft] = useState('')
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const create = (): void => {
    const label = draft.trim()
    if (label === '') return
    onCreate(label)
    setDraft('')
    setDrafting(false)
  }

  const bucket = (key: string, label: string, color: string | null, group?: CitationGroup) => (
    <div key={key} className={selection === key ? `${css.row} ${css.rowActive}` : css.row}>
      <button
        type="button"
        className={css.name}
        aria-pressed={selection === key}
        onClick={() => { onSelect(key) }}
      >
        <span
          className={css.dot}
          style={color === null ? undefined : { background: color }}
          aria-hidden="true"
        />
        <span className={css.label}>{label}</span>
        <span className={css.count}>{selectionCount(citations, key)}</span>
      </button>
      {group !== undefined && (pendingDelete === group.key
        ? (
          <button
            type="button"
            className={css.confirm}
            disabled={disabled}
            onClick={() => {
              onDelete(group.key)
              setPendingDelete(null)
            }}
          >
            {t('group.removeConfirm')}
          </button>
        )
        : (
          <button
            type="button"
            className={css.remove}
            disabled={disabled}
            aria-label={t('group.remove', { label: group.label })}
            title={t('group.remove', { label: group.label })}
            onClick={() => { setPendingDelete(group.key) }}
          >
            <CloseGlyph size={GLYPH_SIZE} />
          </button>
        ))}
    </div>
  )

  return (
    <nav className={css.column}>
      {bucket(ALL_GROUP, t('group.all'), null)}
      {groups.map(group => bucket(group.key, group.label, group.color === '' ? null : group.color, group))}
      {bucket(QUARANTINE_GROUP, t('group.quarantine'), null)}
      <div className={css.footer}>
        {drafting
          ? (
            <div className={css.draft}>
              <input
                className={css.input}
                type="text"
                value={draft}
                autoFocus
                aria-label={t('group.newLabel')}
                placeholder={t('group.newLabel')}
                onChange={(event) => { setDraft(event.target.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter') create() }}
              />
              <div className={css.draftActions}>
                <button
                  type="button"
                  className={css.create}
                  disabled={disabled || draft.trim() === ''}
                  onClick={create}
                >
                  {t('group.create')}
                </button>
                <button
                  type="button"
                  className={css.cancel}
                  onClick={() => {
                    setDraft('')
                    setDrafting(false)
                  }}
                >
                  {t('group.cancel')}
                </button>
              </div>
            </div>
          )
          : (
            <button
              type="button"
              className={css.new}
              disabled={disabled}
              onClick={() => { setDrafting(true) }}
            >
              <PlusGlyph size={GLYPH_SIZE} />
              <span>{t('group.new')}</span>
            </button>
          )}
      </div>
    </nav>
  )
}
