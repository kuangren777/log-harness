/**
 * One literature record as a card.
 *
 * Every number and string on it comes from the record: an absent year, venue,
 * citation count, abstract, or open-access PDF removes its line rather than
 * drawing a placeholder, so the card never claims a fact the sources did not
 * report. The copy action writes the BibTeX entry this package renders and
 * says whether the clipboard took it.
 */
import { useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { LiteratureRecord } from './contract.ts'
import type { SciSearchKey } from './locales.ts'
import { toBibtex } from './bibtex.ts'
import css from './ResultCard.module.css'

/** Authors listed before the card collapses the rest into "et al.". */
const AUTHORS_SHOWN = 3

/** Abstract characters shown before the card offers to expand. */
const ABSTRACT_CLAMP = 300

/** How long the copy outcome stays on the card, in milliseconds. */
const NOTICE_MS = 2400

/** Outcome of the last copy gesture on this card. */
type CopyState = 'idle' | 'copied' | 'failed'

/** Owner-controlled card props. */
export interface ResultCardProps {
  /** The record this card shows. */
  record: LiteratureRecord
  /** Take this record into the research flow. */
  onDeepDive: (record: LiteratureRecord) => void
  /** Localized card copy. */
  t: Translate<SciSearchKey>
}

/**
 * The authors line: the first three, then "et al." when more were reported.
 * @param authors - authors as the sources gave them.
 * @param t - localized card copy.
 * @returns the line, or undefined when the record names no author.
 */
function authorsLine(authors: readonly string[], t: Translate<SciSearchKey>): string | undefined {
  if (authors.length === 0) return undefined
  const shown = authors.slice(0, AUTHORS_SHOWN).join(' · ')
  return authors.length > AUTHORS_SHOWN ? `${shown} ${t('card.etAl')}` : shown
}

/**
 * The venue/year line, built from whichever of the two the record carries.
 * @param record - the record this card shows.
 * @param t - localized card copy.
 * @returns the line, or undefined when the record carries neither.
 */
function venueLine(record: LiteratureRecord, t: Translate<SciSearchKey>): string | undefined {
  const { venue, year } = record
  if (venue !== undefined && year !== undefined) return t('card.venueYear', { venue, year })
  if (venue !== undefined) return venue
  if (year !== undefined) return String(year)
  return undefined
}

/**
 * Write text to the system clipboard through the browser's own API.
 * @param text - the BibTeX entry.
 * @returns whether the clipboard took it.
 */
async function writeClipboard(text: string): Promise<boolean> {
  // Read through an optional property: a browser without the API (an
  // insecure origin, an old engine) must reach the copy notice, not a throw.
  const { clipboard } = navigator as { clipboard?: Clipboard }
  if (clipboard === undefined) return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Render one result card.
 * @param props - owner-controlled card props.
 * @returns the card.
 */
export function ResultCard({ record, onDeepDive, t }: ResultCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [copy, setCopy] = useState<CopyState>('idle')

  // The outcome is a notice, not a state the card keeps: it retires itself,
  // and an unmount before then takes its timer with it.
  useEffect(() => {
    if (copy === 'idle') return undefined
    const timer = setTimeout(() => { setCopy('idle') }, NOTICE_MS)
    return () => { clearTimeout(timer) }
  }, [copy])

  const authors = authorsLine(record.authors, t)
  const venue = venueLine(record, t)
  const abstract = record.abstract
  const clamped = abstract !== undefined && abstract.length > ABSTRACT_CLAMP
  const shownAbstract = clamped && !expanded ? `${abstract.slice(0, ABSTRACT_CLAMP)}…` : abstract

  return (
    <article className={css.card}>
      <div className={css.head}>
        <span className={css.source}>{t(`source.${record.source}`)}</span>
        <a
          className={css.title}
          href={record.url}
          target="_blank"
          rel="noreferrer noopener"
          title={t('card.open', { title: record.title })}
        >
          {record.title}
        </a>
      </div>
      <div className={css.meta}>
        {authors !== undefined && <span>{authors}</span>}
        {venue !== undefined && <span>{venue}</span>}
        {record.citedBy !== undefined && <span>{t('card.citedBy', { count: record.citedBy })}</span>}
      </div>
      {shownAbstract !== undefined && <p className={css.abstract}>{shownAbstract}</p>}
      {clamped && (
        <button
          type="button"
          className={css.toggle}
          onClick={() => { setExpanded(!expanded) }}
        >
          {expanded ? t('card.collapse') : t('card.expand')}
        </button>
      )}
      {(record.doi !== undefined || record.arxivId !== undefined) && (
        <div className={css.badges}>
          {record.doi !== undefined && <span className={css.badge}>{`doi:${record.doi}`}</span>}
          {record.arxivId !== undefined && <span className={css.badge}>{`arXiv:${record.arxivId}`}</span>}
        </div>
      )}
      <div className={css.actions}>
        <button
          type="button"
          className={css.action}
          onClick={() => {
            void writeClipboard(toBibtex(record)).then((ok) => { setCopy(ok ? 'copied' : 'failed') })
          }}
        >
          {t('card.copy')}
        </button>
        {record.pdfUrl !== undefined && (
          <a
            className={css.action}
            href={record.pdfUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('card.pdf')}
          </a>
        )}
        <button
          type="button"
          className={css.action}
          onClick={() => { onDeepDive(record) }}
        >
          {t('card.deepDive')}
        </button>
        {copy !== 'idle' && (
          <span className={copy === 'copied' ? css.notice : `${css.notice} ${css.noticeFailed}`}>
            {copy === 'copied' ? t('card.copied') : t('card.copyFailed')}
          </span>
        )}
      </div>
    </article>
  )
}
