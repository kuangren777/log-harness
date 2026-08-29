/**
 * The full-bleed literature-search view.
 *
 * One search at a time: the store carries what was asked, where that search
 * stands, and what came back, so a trip through another view and back finds
 * the same results rather than an empty hero. The wire never reaches this
 * file — the injected face answers with plain records or a failure code, and
 * every count and duration on screen is read off the result the host
 * returned.
 */
import { useEffect } from 'react'
import { SciLogo } from '@deepseek-ai/dsh-client-ui-brand-sci/client'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { LiteratureRecord, SciSearchInjected } from './contract.ts'
import type { SearchStore } from './stores.ts'
import { RecentChips } from './RecentChips.tsx'
import { ResultCard } from './ResultCard.tsx'
import { SearchGlyph } from './icons.tsx'
import css from './SearchView.module.css'

/** Host error code for a search in which no source answered. */
const ALL_SOURCES_FAILED = 'LITERATURE_ALL_SOURCES_FAILED'

/** Logo edge length in the hero, in CSS pixels (design reference: 46). */
const LOGO_SIZE = 46

/** Glyph edge length inside the query box, in CSS pixels. */
const BOX_GLYPH_SIZE = 16

/** Milliseconds per second, for the elapsed-time reading. */
const MS_PER_SECOND = 1000

/** Full props of the search view, composed from its four shares. */
export type SearchViewProps =
  PropsRuntime<'view', 'search'>
  & PropsStore<SearchStore>
  & InjectFace<SciSearchInjected>
  & PropsLocale<'sci-search'>

/**
 * Render the search view.
 * @param props - the view's composed slot props.
 * @returns the hero, the query box, the recent strip, and the result column.
 */
export function SearchView({ useStore, actions, search, recent, forget, deepDive, t }: SearchViewProps) {
  const query = useStore(s => s.query)
  const status = useStore(s => s.status)
  const result = useStore(s => s.result)
  const error = useStore(s => s.error)
  const entries = useStore(s => s.recent)
  const loading = status === 'loading'

  // The history is the host's, read once per mount: the store outlives this
  // component, so a settled read after an unmount still lands where the next
  // mount reads it.
  useEffect(() => {
    void recent().then((rows) => { actions.setRecent(rows) })
  }, [recent, actions])

  const run = (text: string): void => {
    const trimmed = text.trim()
    if (trimmed === '' || loading) return
    actions.begin(trimmed)
    void search({ query: trimmed }).then(async (outcome) => {
      if (outcome.ok) actions.succeed(outcome.result)
      else actions.fail(outcome.code)
      actions.setRecent(await recent())
    })
  }

  const dig = (record: LiteratureRecord): void => {
    deepDive(t('deepDive.prompt', { query: record.title }))
  }

  return (
    <div className={css.root}>
      <div className={css.inner}>
        <span className={css.logo}><SciLogo size={LOGO_SIZE} /></span>
        <h1 className={css.title}>{t('hero.title')}</h1>
        <p className={css.subtitle}>{t('hero.subtitle')}</p>
        <div className={css.box}>
          <span className={css.boxIcon}><SearchGlyph size={BOX_GLYPH_SIZE} /></span>
          <input
            className={css.input}
            type="text"
            value={query}
            disabled={loading}
            aria-label={t('search.label')}
            placeholder={t('search.placeholder')}
            onChange={(event) => { actions.setQuery(event.target.value) }}
            onKeyDown={(event) => { if (event.key === 'Enter') run(query) }}
          />
          <button
            type="button"
            className={css.submit}
            disabled={loading || query.trim() === ''}
            onClick={() => { run(query) }}
          >
            {loading ? t('search.running') : t('search.submit')}
          </button>
        </div>
        <RecentChips
          entries={entries}
          disabled={loading}
          onPick={(picked) => { run(picked) }}
          onForget={(id) => { void forget(id).then((rows) => { actions.setRecent(rows) }) }}
          t={t}
        />
        {status === 'error' && (
          <div className={css.error} role="alert">
            {error === ALL_SOURCES_FAILED ? t('error.allFailed') : t('error.generic', { code: error })}
          </div>
        )}
        {status === 'done' && result !== null && (
          <div className={css.results} data-sci-motion>
            <div className={css.resultsHead}>
              <span>
                {t('results.header', {
                  count: result.records.length,
                  seconds: (result.elapsedMs / MS_PER_SECOND).toFixed(1),
                })}
              </span>
              {result.sourceErrors.length > 0 && (
                <span>{t('results.sourceErrors', { count: result.sourceErrors.length })}</span>
              )}
            </div>
            {result.sourceErrors.length > 0 && (
              <div className={css.sourceErrors}>
                {result.sourceErrors.map(failure => (
                  <span key={failure.source}>
                    {t('results.sourceError', { source: t(`source.${failure.source}`), code: failure.code })}
                  </span>
                ))}
              </div>
            )}
            {result.records.length === 0
              ? <p className={css.empty}>{t('results.empty')}</p>
              : (
                <div className={css.cards}>
                  {result.records.map(record => (
                    <ResultCard key={record.id} record={record} onDeepDive={dig} t={t} />
                  ))}
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  )
}
