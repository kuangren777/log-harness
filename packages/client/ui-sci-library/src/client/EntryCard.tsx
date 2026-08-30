/**
 * One library entry as a card.
 *
 * Every fact on it comes from the entry: an absent year, citation count,
 * abstract, tag, or file removes its element rather than drawing a
 * placeholder, so the card never claims something the library does not hold.
 * The whole card is the control that opens the entry, which is why it is a
 * button rather than a div with a click handler.
 */
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { LibraryEntry } from './contract.ts'
import type { SciLibraryKey } from './locales.ts'
import css from './EntryCard.module.css'

/** Abstract characters a card shows before it stops. */
const ABSTRACT_CLAMP = 120

/** Tags a card shows before it stops; the detail page shows them all. */
const TAGS_SHOWN = 2

/** Owner-controlled card props. */
export interface EntryCardProps {
  /** The entry this card shows. */
  entry: LibraryEntry
  /** Open this entry's detail page. */
  onOpen: (id: string) => void
  /** Localized card copy. */
  t: Translate<SciLibraryKey>
}

/**
 * The abstract as the card shows it: cut at the clamp with an ellipsis, or
 * whole when it is already short.
 * @param abstract - the entry's abstract, when it has one.
 * @returns the shown text, or undefined when there is no abstract.
 */
export function clampAbstract(abstract: string | undefined): string | undefined {
  if (abstract === undefined) return undefined
  return abstract.length > ABSTRACT_CLAMP ? `${abstract.slice(0, ABSTRACT_CLAMP)}…` : abstract
}

/**
 * Render one entry card.
 * @param props - owner-controlled card props.
 * @returns the card.
 */
export function EntryCard({ entry, onOpen, t }: EntryCardProps) {
  const abstract = clampAbstract(entry.abstract)
  const source = entry.sources[0]
  return (
    <button
      type="button"
      className={css.card}
      title={t('card.open', { title: entry.title })}
      onClick={() => { onOpen(entry.id) }}
    >
      <span className={css.head}>
        {source !== undefined && <span className={css.source}>{t(`source.${source}`)}</span>}
        {entry.year !== undefined && <span className={css.year}>{entry.year}</span>}
        <span className={css.status}>{t(`status.${entry.status}`)}</span>
      </span>
      <span className={css.title}>{entry.title}</span>
      {abstract !== undefined && <span className={css.abstract}>{abstract}</span>}
      <span className={css.foot}>
        {entry.tags.slice(0, TAGS_SHOWN).map(tag => (
          <span key={tag} className={css.tag}>{tag}</span>
        ))}
        {entry.citedBy !== undefined && (
          <span className={css.fact}>{t('card.cited', { count: entry.citedBy })}</span>
        )}
        {entry.files.length > 0 && (
          <span className={css.fact}>{t('card.files', { count: entry.files.length })}</span>
        )}
      </span>
    </button>
  )
}
