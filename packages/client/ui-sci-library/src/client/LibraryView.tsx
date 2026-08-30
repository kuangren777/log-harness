/**
 * The full-bleed knowledge-library view: the list, and the detail page of
 * whichever entry is open.
 *
 * One read at a time, and the store carries what was asked, what came back,
 * and which entry is open — so a trip through the research flow and back
 * finds the same page rather than an empty library. The wire never reaches
 * this file: the injected face answers with plain entries or a failure code,
 * and every count on screen is read off what the host returned.
 *
 * Typing rests before it is read, filters and tags are read at once: a
 * keystroke should not be a request, but pressing a chip should not wait.
 */
import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { LibraryEntry, LibraryQuery, SciLibraryInjected } from './contract.ts'
import type { LibraryFilter, LibraryStore } from './stores.ts'
import { EntryCard } from './EntryCard.tsx'
import { EntryDetail } from './EntryDetail.tsx'
import { Filters } from './Filters.tsx'
import { UploadButton } from './UploadButton.tsx'
import { SearchGlyph } from './icons.tsx'
import css from './LibraryView.module.css'

/** How long a typed query rests before the library is read, in milliseconds. */
export const QUERY_DEBOUNCE_MS = 250

/** Glyph edge length inside the query box, in CSS pixels. */
const BOX_GLYPH_SIZE = 16

/** The three chips that select a kind; the other two select everything or a status. */
const KIND_FILTERS: ReadonlySet<LibraryFilter> = new Set<LibraryFilter>(['paper', 'dataset', 'note'])

/** Full props of the library view, composed from its four shares. */
export type LibraryViewProps =
  PropsRuntime<'view', 'library'>
  & PropsStore<LibraryStore>
  & InjectFace<SciLibraryInjected>
  & PropsLocale<'sci-library'>

/**
 * The request one view state asks the host for. Members are added rather than
 * set to undefined: the host takes an absent filter, not an empty one.
 * @param term - the settled query text.
 * @param filter - the pressed chip.
 * @param tag - the tag being filtered by, or null.
 * @returns the request as the host takes it.
 */
export function requestOf(term: string, filter: LibraryFilter, tag: string | null): LibraryQuery {
  const trimmed = term.trim()
  return {
    ...(trimmed === '' ? {} : { query: trimmed }),
    ...(KIND_FILTERS.has(filter) ? { kind: filter as 'paper' | 'dataset' | 'note' } : {}),
    ...(filter === 'lowConfidence' ? { status: 'low-confidence' as const } : {}),
    ...(tag === null ? {} : { tag }),
  }
}

/**
 * Render the library view.
 * @param props - the view's composed slot props.
 * @returns the list, or the detail page of the open entry.
 */
export function LibraryView(props: LibraryViewProps) {
  const { useStore, actions, list, get, update, remove, related, fetchPdf, upload, readText, t } = props
  const query = useStore(s => s.query)
  const filter = useStore(s => s.filter)
  const tag = useStore(s => s.tag)
  const status = useStore(s => s.status)
  const page = useStore(s => s.page)
  const error = useStore(s => s.error)
  const selected = useStore(s => s.selected)
  const detail = useStore(s => s.detail)
  const detailError = useStore(s => s.detailError)
  const relatedRows = useStore(s => s.related)
  // The settled query: what the box currently says, once it has rested. The
  // box's own text lives in the store because it survives a view switch; the
  // pause before it counts as a request is only this component's business.
  const [term, setTerm] = useState(query)

  useEffect(() => {
    if (term === query) return undefined
    const timer = setTimeout(() => { setTerm(query) }, QUERY_DEBOUNCE_MS)
    return () => { clearTimeout(timer) }
  }, [term, query])

  useEffect(() => {
    actions.begin()
    void list(requestOf(term, filter, tag)).then((outcome) => {
      if (outcome.ok) actions.succeed(outcome.value)
      else actions.fail(outcome.code)
    })
  }, [term, filter, tag, list, actions])

  useEffect(() => {
    if (selected === null) return
    void get(selected).then((outcome) => {
      if (outcome.ok) actions.detailLoaded(outcome.value)
      else actions.detailFailed(outcome.code)
    })
    void related(selected).then((rows) => { actions.setRelated(rows) })
  }, [selected, get, related, actions])

  if (selected !== null) {
    return (
      <div className={css.root}>
        <div className={css.inner}>
          {detail === null
            ? (
              <>
                <button type="button" className={css.back} onClick={() => { actions.close() }}>
                  {`← ${t('detail.back')}`}
                </button>
                {detailError === null
                  ? <p className={css.note}>{t('detail.loading')}</p>
                  : <p className={css.error} role="alert">{t('detail.error', { code: detailError })}</p>}
              </>
            )
            : (
              <EntryDetail
                key={detail.id}
                entry={detail}
                related={relatedRows}
                onBack={() => { actions.close() }}
                onOpen={(id) => { actions.open(id) }}
                onPatched={(entry) => { actions.patched(entry) }}
                onRemoved={(id) => { actions.removed(id) }}
                update={update}
                remove={remove}
                fetchPdf={fetchPdf}
                upload={upload}
                readText={readText}
                t={t}
              />
            )}
        </div>
      </div>
    )
  }

  return (
    <div className={css.root}>
      <div className={css.inner}>
        <div className={css.head}>
          <div>
            <h1 className={css.title}>{t('hero.title')}</h1>
            <p className={css.subtitle}>
              {t('hero.subtitle', {
                papers: page?.counts.paper ?? 0,
                datasets: page?.counts.dataset ?? 0,
              })}
            </p>
          </div>
          <UploadButton
            entryId="new"
            label={t('upload.entry')}
            upload={upload}
            onUploaded={(entry: LibraryEntry) => { actions.patched(entry) }}
            t={t}
          />
        </div>

        <div className={css.box}>
          <span className={css.boxIcon}><SearchGlyph size={BOX_GLYPH_SIZE} /></span>
          <input
            className={css.input}
            type="text"
            value={query}
            aria-label={t('search.label')}
            placeholder={t('search.placeholder')}
            onChange={(event) => { actions.setQuery(event.target.value) }}
          />
        </div>

        {page !== null && (
          <Filters
            counts={page.counts}
            tags={page.tags}
            filter={filter}
            tag={tag}
            onFilter={(next) => { actions.setFilter(next) }}
            onTag={(next) => { actions.setTag(next) }}
            t={t}
          />
        )}

        {status === 'error' && (
          <p className={css.error} role="alert">{t('list.error', { code: error })}</p>
        )}
        {status === 'loading' && page === null && <p className={css.note}>{t('list.loading')}</p>}
        {page !== null && (
          <>
            <div className={css.count}>
              {t('list.count', { shown: page.entries.length, total: page.total })}
            </div>
            {page.entries.length === 0
              ? (
                <p className={css.note}>
                  {page.counts.all === 0 ? t('list.empty') : t('list.noMatch')}
                </p>
              )
              : (
                <div className={css.cards} data-sci-motion>
                  {page.entries.map(entry => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      onOpen={(id) => { actions.open(id) }}
                      t={t}
                    />
                  ))}
                </div>
              )}
          </>
        )}
      </div>
    </div>
  )
}
