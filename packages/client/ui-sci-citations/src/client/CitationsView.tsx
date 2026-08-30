/**
 * The full-bleed citation-pool view.
 *
 * One project at a time: the store carries which project is open, which
 * bucket the left column selects, and the pool the host last reported, so a
 * trip through another view and back finds the same pool rather than an empty
 * surface. The wire never reaches this file — the injected face answers with
 * a pool or a failure code, and every count, confidence, and use count on
 * screen is read off that pool.
 *
 * Both writes that leave the browser (the clipboard and the download) are
 * total: each one states whether it landed, so a header button never fails
 * silently.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { PoolOutcome, SciCitationsInjected } from './contract.ts'
import type { SciCitationsKey } from './locales.ts'
import type { CitationsStore } from './stores.ts'
import { CitationRow } from './CitationRow.tsx'
import { GroupColumn } from './GroupColumn.tsx'
import { citationBlock, exportGroupOf, visibleCitations } from './pool-view.ts'
import { downloadText, writeClipboard } from './save.ts'
import css from './CitationsView.module.css'

/** How long a copy or export outcome stays on the header, in milliseconds. */
const NOTICE_MS = 2400

/** The code an export reports when the browser exposes no download path. */
const DOWNLOAD_UNAVAILABLE = 'CITATIONS_DOWNLOAD_UNAVAILABLE'

/** Outcome of the last clipboard or download gesture. */
type Notice =
  | { kind: 'copied'; count: number }
  | { kind: 'copy-failed' }
  | { kind: 'exported'; file: string }
  | { kind: 'export-failed'; code: string }

/**
 * The one line one clipboard or download outcome reads as.
 * @param notice - the outcome the header is showing.
 * @param t - localized header copy.
 * @returns the notice text.
 */
function noticeText(notice: Notice, t: Translate<SciCitationsKey>): string {
  if (notice.kind === 'copied') return t('notice.copied', { count: notice.count })
  if (notice.kind === 'copy-failed') return t('notice.copyFailed')
  if (notice.kind === 'exported') return t('notice.exported', { file: notice.file })
  return t('notice.exportFailed', { code: notice.code })
}

/** Full props of the citation-pool view, composed from its four shares. */
export type CitationsViewProps =
  PropsRuntime<'view', 'citations'>
  & PropsStore<CitationsStore>
  & InjectFace<SciCitationsInjected>
  & PropsLocale<'sci-citations'>

/**
 * Render the citation-pool view.
 * @param props - the view's composed slot props.
 * @returns the header, the group column, and the citation list.
 */
export function CitationsView({
  useStore, actions, projects, pool, createGroup, removeGroup, move, remove, rescan, exportBibtex, t,
}: CitationsViewProps) {
  const rows = useStore(s => s.projects)
  const project = useStore(s => s.project)
  const selection = useStore(s => s.group)
  const current = useStore(s => s.pool)
  const error = useStore(s => s.error)
  const busy = useStore(s => s.busy)
  const [asked, setAsked] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  // The project list is the host's, read once per mount: the store outlives
  // this component, so a settled read after an unmount still lands where the
  // next mount reads it.
  useEffect(() => {
    void projects().then((list) => {
      actions.setProjects(list)
      setAsked(true)
    })
  }, [projects, actions])

  useEffect(() => {
    if (project === '') return
    actions.beginLoad()
    void pool(project).then((outcome) => {
      if (outcome.ok) actions.loaded(outcome.pool)
      else actions.failed(outcome.code)
    })
  }, [project, pool, actions])

  // The outcome is a notice, not a state the view keeps: it retires itself,
  // and an unmount before then takes its timer with it.
  useEffect(() => {
    if (notice === null) return undefined
    const timer = setTimeout(() => { setNotice(null) }, NOTICE_MS)
    return () => { clearTimeout(timer) }
  }, [notice])

  const citations = useMemo(
    () => (current === null ? [] : visibleCitations(current.citations, selection)),
    [current, selection],
  )

  const settle = (outcome: PoolOutcome): void => {
    if (outcome.ok) actions.loaded(outcome.pool)
    else actions.failed(outcome.code)
    actions.setBusy(false)
  }

  const write = (work: Promise<PoolOutcome>): void => {
    actions.setBusy(true)
    void work.then(settle)
  }

  const scan = (): void => {
    setScanning(true)
    actions.setBusy(true)
    void rescan(project).then((outcome) => {
      settle(outcome)
      setScanning(false)
    })
  }

  const copy = (): void => {
    void writeClipboard(citationBlock(citations)).then((ok) => {
      setNotice(ok ? { kind: 'copied', count: citations.length } : { kind: 'copy-failed' })
    })
  }

  const save = (): void => {
    actions.setBusy(true)
    void exportBibtex(project, exportGroupOf(selection)).then((outcome) => {
      actions.setBusy(false)
      if (!outcome.ok) {
        setNotice({ kind: 'export-failed', code: outcome.code })
        return
      }
      const file = `${project}.bib`
      setNotice(downloadText(file, outcome.bibtex)
        ? { kind: 'exported', file }
        : { kind: 'export-failed', code: DOWNLOAD_UNAVAILABLE })
    })
  }

  const exportGroup = current === null
    ? undefined
    : current.groups.find(group => group.key === exportGroupOf(selection))
  const frozen = busy || project === ''

  return (
    <div className={css.root}>
      <div className={css.inner}>
        <header className={css.header}>
          <div className={css.headings}>
            <h1 className={css.title}>{t('view.title')}</h1>
            {current !== null && (
              <p className={css.stats}>
                {t('view.stats', {
                  total: current.stats.total,
                  avg: current.stats.avgConfidence,
                  quarantined: current.stats.quarantined,
                })}
              </p>
            )}
            {current !== null && current.stats.scannedFiles > 0 && (
              <p className={css.scanned}>{t('view.scanned', { files: current.stats.scannedFiles })}</p>
            )}
          </div>
          <div className={css.controls}>
            {rows.length > 0 && (
              <select
                className={css.select}
                value={project}
                aria-label={t('project.label')}
                onChange={(event) => { actions.chooseProject(event.target.value) }}
              >
                {rows.map(row => <option key={row.slug} value={row.slug}>{row.slug}</option>)}
              </select>
            )}
            <button
              type="button"
              className={css.ghost}
              disabled={frozen}
              title={t('action.rescanHint')}
              onClick={scan}
            >
              {scanning ? t('action.rescanning') : t('action.rescan')}
            </button>
            <button
              type="button"
              className={css.ghost}
              disabled={frozen}
              title={exportGroup === undefined
                ? t('action.exportAllHint')
                : t('action.exportGroupHint', { label: exportGroup.label })}
              onClick={save}
            >
              {t('action.export')}
            </button>
            <button
              type="button"
              className={css.primary}
              disabled={frozen || citations.length === 0}
              title={t('action.copyHint', { count: citations.length })}
              onClick={copy}
            >
              {t('action.copy')}
            </button>
          </div>
        </header>
        {notice !== null && <p className={css.notice} role="status">{noticeText(notice, t)}</p>}
        {error !== null && (
          <p className={css.error} role="alert">
            {current === null ? t('error.load', { code: error }) : t('error.action', { code: error })}
          </p>
        )}
        {asked && rows.length === 0 && <p className={css.empty}>{t('empty.projects')}</p>}
        {current !== null && (
          <div className={css.panes}>
            <GroupColumn
              groups={current.groups}
              citations={current.citations}
              selection={selection}
              disabled={busy}
              onSelect={(key) => { actions.chooseGroup(key) }}
              onCreate={(label) => { write(createGroup(project, label)) }}
              onDelete={(key) => { write(removeGroup(project, key)) }}
              t={t}
            />
            <div className={css.list} data-sci-motion>
              {current.citations.length === 0 && <p className={css.empty}>{t('empty.pool')}</p>}
              {current.citations.length > 0 && citations.length === 0 && (
                <p className={css.empty}>{t('empty.group')}</p>
              )}
              {citations.map(citation => (
                <CitationRow
                  key={citation.id}
                  citation={citation}
                  groups={current.groups}
                  disabled={busy}
                  onMove={(citekey, group) => { write(move(project, citekey, group)) }}
                  onRemove={(citekey) => { write(remove(project, citekey)) }}
                  t={t}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
