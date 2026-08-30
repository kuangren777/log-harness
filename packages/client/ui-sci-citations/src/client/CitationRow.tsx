/**
 * One citation as a row.
 *
 * Every string and number on it comes from the record the host returned: an
 * absent year, venue, or source list removes its slot rather than drawing a
 * placeholder. The two destructive gestures are explicit — the group tag
 * opens a menu of the project's real groups (the design reference's
 * click-to-rotate would move a citation somewhere the user never chose), and
 * the × asks before it drops the citation.
 */
import { useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { Citation, CitationGroup } from './contract.ts'
import type { SciCitationsKey } from './locales.ts'
import { CloseGlyph } from './icons.tsx'
import { confidenceTone, UNGROUPED } from './pool-view.ts'
import css from './CitationRow.module.css'

/** Glyph edge length inside the row's remove button, in CSS pixels. */
const GLYPH_SIZE = 13

/** Owner-controlled props of one citation row. */
export interface CitationRowProps {
  /** The citation this row shows. */
  citation: Citation
  /** The project's groups, for the tag's label and its menu. */
  groups: readonly CitationGroup[]
  /** Whether a write is in flight, which freezes both gestures. */
  disabled: boolean
  /** Move this citation into one group. */
  onMove: (citekey: string, group: string) => void
  /** Drop this citation from the pool. */
  onRemove: (citekey: string) => void
  /** Localized row copy. */
  t: Translate<SciCitationsKey>
}

/**
 * The label one group key reads as: the group's own label, the ungrouped
 * copy, or the bare key when the pool names a group the project has dropped.
 * @param key - the citation's group key.
 * @param groups - the project's groups.
 * @param t - localized row copy.
 * @returns the label to draw.
 */
function groupLabel(
  key: string,
  groups: readonly CitationGroup[],
  t: Translate<SciCitationsKey>,
): string {
  if (key === UNGROUPED) return t('group.ungrouped')
  return groups.find(group => group.key === key)?.label ?? key
}

/**
 * The origin line: the sources that reported this work, and its year.
 * @param citation - the citation this row shows.
 * @param t - localized row copy.
 * @returns the line, or undefined when the record carries neither.
 */
function originLine(citation: Citation, t: Translate<SciCitationsKey>): string | undefined {
  const sources = citation.sources.join(' / ')
  const { year } = citation
  if (sources !== '' && year !== undefined) return t('row.origin', { sources, year })
  if (sources !== '') return sources
  if (year !== undefined) return String(year)
  return undefined
}

/**
 * Render one citation row.
 * @param props - owner-controlled row props.
 * @returns the row.
 */
export function CitationRow({ citation, groups, disabled, onMove, onRemove, t }: CitationRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const origin = originLine(citation, t)
  const tone = confidenceTone(citation.confidence)
  const current = groups.find(group => group.key === citation.group)
  const menuLabel = t('row.groupMenu', { citekey: citation.citekey })
  // Ungrouped closes the menu: it is the destination the pool always has, and
  // the host never lists it among the groups a user created.
  const options = [
    ...groups.map(group => ({ key: group.key, label: group.label })),
    { key: UNGROUPED, label: t('group.ungrouped') },
  ]
  const choose = (key: string): void => {
    setMenuOpen(false)
    if (key !== citation.group) onMove(citation.citekey, key)
  }

  return (
    <article
      className={css.row}
      onKeyDown={(event) => { if (event.key === 'Escape') setMenuOpen(false) }}
    >
      <div className={css.head}>
        <span className={css.citekey}>{`[${citation.citekey}]`}</span>
        <span className={css.title}>{citation.title}</span>
        {citation.quarantined && <span className={css.quarantine}>{t('row.quarantined')}</span>}
        <div className={css.tagBox}>
          <button
            type="button"
            className={css.tag}
            disabled={disabled}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={menuLabel}
            title={menuLabel}
            onClick={() => { setMenuOpen(!menuOpen) }}
          >
            <span
              className={css.dot}
              style={current === undefined || current.color === '' ? undefined : { background: current.color }}
              aria-hidden="true"
            />
            <span>{t('row.group', { label: groupLabel(citation.group, groups, t) })}</span>
          </button>
          {menuOpen && (
            <div className={css.menu} role="menu">
              {options.map(option => (
                <button
                  key={option.key}
                  type="button"
                  role="menuitem"
                  className={css.menuItem}
                  aria-current={option.key === citation.group}
                  onClick={() => { choose(option.key) }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {confirming
          ? (
            <>
              <button
                type="button"
                className={css.confirm}
                disabled={disabled}
                onClick={() => {
                  setConfirming(false)
                  onRemove(citation.citekey)
                }}
              >
                {t('row.removeConfirm')}
              </button>
              <button
                type="button"
                className={css.cancel}
                onClick={() => { setConfirming(false) }}
              >
                {t('row.removeCancel')}
              </button>
            </>
          )
          : (
            <button
              type="button"
              className={css.remove}
              disabled={disabled}
              aria-label={t('row.remove', { citekey: citation.citekey })}
              title={t('row.remove', { citekey: citation.citekey })}
              onClick={() => { setConfirming(true) }}
            >
              <CloseGlyph size={GLYPH_SIZE} />
            </button>
          )}
      </div>
      <div className={css.facts}>
        {origin !== undefined && <span className={css.origin}>{origin}</span>}
        <span>{t('row.uses', { count: citation.uses })}</span>
        <span className={`${css.confidence} ${css[tone]}`}>
          {t('row.confidence', { value: citation.confidence })}
        </span>
      </div>
    </article>
  )
}
