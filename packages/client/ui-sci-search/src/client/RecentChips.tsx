/**
 * The recent-query strip: one chip per query the host remembers, each a pair
 * of controls sharing a pill — the query itself re-runs the search, the ×
 * forgets that history row.
 *
 * The row is addressed by its host id, never by the query text: two searches
 * of the same words are two rows, and forgetting one must not take the other.
 */
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { RecentQuery } from './contract.ts'
import type { SciSearchKey } from './locales.ts'
import css from './RecentChips.module.css'

/** Owner-controlled chip-strip props. */
export interface RecentChipsProps {
  /** The remembered queries, newest first. */
  entries: readonly RecentQuery[]
  /** True while a search runs; both controls refuse until it settles. */
  disabled: boolean
  /** Re-run one remembered query. */
  onPick: (query: string) => void
  /** Forget one history row by its id. */
  onForget: (id: string) => void
  /** Localized strip copy. */
  t: Translate<SciSearchKey>
}

/**
 * Render the recent-query chips.
 * @param props - owner-controlled chip-strip props.
 * @returns the chip strip, or nothing when the host remembers no query.
 */
export function RecentChips({ entries, disabled, onPick, onForget, t }: RecentChipsProps) {
  if (entries.length === 0) return null
  return (
    <div className={css.root} role="group" aria-label={t('recent.title')}>
      {entries.map(entry => (
        <span key={entry.id} className={css.chip}>
          <button
            type="button"
            className={css.query}
            disabled={disabled}
            title={t('recent.entry', { query: entry.query, hits: entry.hits })}
            onClick={() => { onPick(entry.query) }}
          >
            {entry.query}
          </button>
          <button
            type="button"
            className={css.forget}
            disabled={disabled}
            aria-label={t('recent.forget', { query: entry.query })}
            onClick={() => { onForget(entry.id) }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  )
}
