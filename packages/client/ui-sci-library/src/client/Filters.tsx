/**
 * The filter strip and the tag cloud.
 *
 * Every chip's number is a real count the host computed over the whole
 * library, and the cloud is the host's tag census — a chip whose count is
 * zero still shows, because "0 datasets" is a fact about this library and
 * hiding the chip would make the strip's shape depend on the data.
 */
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { LibraryCounts, LibraryTagCount } from './contract.ts'
import type { LibraryFilter } from './stores.ts'
import type { SciLibraryKey } from './locales.ts'
import css from './Filters.module.css'

/** Tags the cloud shows before it stops; the host orders them by use. */
const TAGS_SHOWN = 12

/** The five chips, in strip order, each with the count member it reads. */
const CHIPS: readonly { filter: LibraryFilter; count: keyof LibraryCounts; key: SciLibraryKey }[] = [
  { filter: 'all', count: 'all', key: 'filter.all' },
  { filter: 'paper', count: 'paper', key: 'filter.paper' },
  { filter: 'dataset', count: 'dataset', key: 'filter.dataset' },
  { filter: 'note', count: 'note', key: 'filter.note' },
  { filter: 'lowConfidence', count: 'lowConfidence', key: 'filter.lowConfidence' },
]

/** Owner-controlled filter-strip props. */
export interface FiltersProps {
  /** Library totals as the host reported them. */
  counts: LibraryCounts
  /** The host's tag census, most used first. */
  tags: readonly LibraryTagCount[]
  /** The pressed chip. */
  filter: LibraryFilter
  /** The tag being filtered by, or null. */
  tag: string | null
  /** Press one chip. */
  onFilter: (filter: LibraryFilter) => void
  /** Press one tag, or clear the tag filter with null. */
  onTag: (tag: string | null) => void
  /** Localized strip copy. */
  t: Translate<SciLibraryKey>
}

/**
 * Render the filter chips over the tag cloud.
 * @param props - owner-controlled filter-strip props.
 * @returns the chip strip and, when the host reported any tag, the cloud.
 */
export function Filters({ counts, tags, filter, tag, onFilter, onTag, t }: FiltersProps) {
  const cloud = tags.slice(0, TAGS_SHOWN)
  return (
    <>
      <div className={css.chips}>
        {CHIPS.map(chip => (
          <button
            key={chip.filter}
            type="button"
            className={chip.filter === filter ? `${css.chip} ${css.chipOn}` : css.chip}
            aria-pressed={chip.filter === filter}
            onClick={() => { onFilter(chip.filter) }}
          >
            {t(chip.key, { count: counts[chip.count] })}
          </button>
        ))}
      </div>
      {cloud.length > 0 && (
        <div className={css.tags} role="group" aria-label={t('tags.title')}>
          <span className={css.tagsTitle}>{t('tags.title')}</span>
          {cloud.map(row => (
            <button
              key={row.tag}
              type="button"
              className={row.tag === tag ? `${css.tag} ${css.tagOn}` : css.tag}
              aria-pressed={row.tag === tag}
              onClick={() => { onTag(row.tag === tag ? null : row.tag) }}
            >
              {`${row.tag} · ${row.count}`}
            </button>
          ))}
          {tag !== null && (
            <button
              type="button"
              className={css.tagClear}
              onClick={() => { onTag(null) }}
            >
              {t('tags.clear')}
            </button>
          )}
        </div>
      )}
    </>
  )
}
