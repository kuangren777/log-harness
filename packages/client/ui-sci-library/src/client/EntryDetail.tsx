/**
 * One library entry, whole.
 *
 * The entry the host last returned is the only source on this page: the tag
 * chips, the status, the three statistics, the files, and the related list
 * are read off it, and every edit is a write that answers with the next
 * entry. Nothing is applied optimistically — a refused write leaves the page
 * showing what the library still holds, with the failure stated beside the
 * control that caused it.
 *
 * The note is the one field with a draft, because typing must not be one
 * write per keystroke; it settles after a pause and then follows the same
 * path as every other edit.
 */
import { useCallback, useEffect, useState } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type {
  FileTextOutcome, LibraryEntry, LibraryOutcome, LibraryPatch, LibraryStatus, UploadOutcome, UploadRequest,
} from './contract.ts'
import type { SciLibraryKey } from './locales.ts'
import { FilePane } from './FilePane.tsx'
import { TagEditor } from './TagEditor.tsx'
import { UploadButton } from './UploadButton.tsx'
import { toBibtex } from './bibtex.ts'
import { fileUrl } from './routes.ts'
import css from './EntryDetail.module.css'

/** How long the note rests before it is written, in milliseconds. */
export const NOTE_DEBOUNCE_MS = 700

/** The five statuses, in the order the select offers them. */
const STATUSES: readonly LibraryStatus[] = ['unread', 'reading', 'read', 'verified', 'low-confidence']

/** Media type of a stored file this page can open as a PDF. */
const PDF_MEDIA_TYPE = 'application/pdf'

/** Outcome of the last copy gesture on this page. */
type CopyState = 'idle' | 'copied' | 'failed'

/** Owner-controlled detail props. */
export interface EntryDetailProps {
  /** The open entry as the host last reported it. */
  entry: LibraryEntry
  /** Entries the host scores as related to it. */
  related: readonly LibraryEntry[]
  /** Return to the list. */
  onBack: () => void
  /** Open another entry's detail page. */
  onOpen: (id: string) => void
  /** Report the entry the host returned after a write. */
  onPatched: (entry: LibraryEntry) => void
  /** Report that the entry is gone. */
  onRemoved: (id: string) => void
  /** Write the editable fields of this entry. */
  update: (id: string, patch: LibraryPatch) => Promise<LibraryOutcome<LibraryEntry>>
  /** Remove this entry and its files. */
  remove: (id: string) => Promise<LibraryOutcome<null>>
  /** Have the host download this entry's open-access PDF into the library. */
  fetchPdf: (id: string) => Promise<LibraryOutcome<LibraryEntry>>
  /** Send one picked file to the library's upload route. */
  upload: (request: UploadRequest) => Promise<UploadOutcome>
  /** Read one stored file as text. */
  readText: (entryId: string, name: string) => Promise<FileTextOutcome>
  /** Localized detail copy. */
  t: Translate<SciLibraryKey>
}

/**
 * The identifier line under the title: the authors, then whichever
 * identifiers the entry carries.
 * @param entry - the open entry.
 * @returns the line's segments, which may be empty.
 */
export function identityLine(entry: LibraryEntry): readonly string[] {
  const parts: string[] = []
  if (entry.authors.length > 0) parts.push(entry.authors.join(', '))
  if (entry.doi !== undefined) parts.push(`doi:${entry.doi}`)
  if (entry.arxivId !== undefined) parts.push(`arXiv:${entry.arxivId}`)
  return parts
}

/**
 * Where 「打开 PDF」 points: a PDF stored in the library when there is one,
 * otherwise the open-access url the sources reported.
 * @param entry - the open entry.
 * @returns the url, or undefined when this entry has no PDF at all.
 */
export function pdfTarget(entry: LibraryEntry): string | undefined {
  const stored = entry.files.find(file => file.mediaType === PDF_MEDIA_TYPE)
  if (stored !== undefined) return fileUrl(entry.id, stored.name)
  return entry.pdfUrl
}

/**
 * Render the detail page of one entry.
 * @param props - owner-controlled detail props.
 * @returns the page.
 */
export function EntryDetail(props: EntryDetailProps) {
  const { entry, related, onBack, onOpen, onPatched, onRemoved, update, remove, fetchPdf, upload, readText, t } = props
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [note, setNote] = useState(entry.note ?? '')
  const [copy, setCopy] = useState<CopyState>('idle')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const save = useCallback((patch: LibraryPatch): void => {
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    void update(entry.id, patch).then((outcome) => {
      setSaving(false)
      if (outcome.ok) {
        setSaved(true)
        onPatched(outcome.value)
      } else {
        setSaveError(outcome.code)
      }
    })
  }, [entry.id, update, onPatched])

  // The note settles before it is written: one write per pause, not one per
  // keystroke. A draft equal to what the host already holds writes nothing,
  // which is also what makes the write-back from `save` terminate.
  useEffect(() => {
    if (note === (entry.note ?? '')) return undefined
    const timer = setTimeout(() => { save({ note }) }, NOTE_DEBOUNCE_MS)
    return () => { clearTimeout(timer) }
  }, [note, entry.note, save])

  const target = pdfTarget(entry)
  const identity = identityLine(entry)

  return (
    <div className={css.root}>
      <button type="button" className={css.back} onClick={onBack}>{`← ${t('detail.back')}`}</button>

      <article className={css.sheet}>
        <div className={css.meta}>
          {entry.sources.map(source => (
            <span key={source} className={css.source}>{t(`source.${source}`)}</span>
          ))}
          {entry.year !== undefined && <span className={css.year}>{entry.year}</span>}
          <span className={css.status}>{t(`status.${entry.status}`)}</span>
          {entry.citedBy !== undefined && (
            <span className={css.cited}>{t('card.cited', { count: entry.citedBy })}</span>
          )}
        </div>

        <h1 className={css.title}>{entry.title}</h1>
        {identity.length > 0 && <div className={css.identity}>{identity.join(' · ')}</div>}
        <p className={css.abstract}>{entry.abstract ?? t('detail.abstractNone')}</p>

        <div className={css.stats}>
          <div className={css.stat}>
            <div className={css.statValue}>{entry.citedBy ?? t('detail.stat.none')}</div>
            <div className={css.statLabel}>{t('detail.stat.cited')}</div>
          </div>
          <div className={css.stat}>
            <div className={css.statValue}>{entry.year ?? t('detail.stat.none')}</div>
            <div className={css.statLabel}>{t('detail.stat.year')}</div>
          </div>
          <div className={css.stat}>
            <div className={css.statValue}>{entry.sources.length}</div>
            <div className={css.statLabel}>{t('detail.stat.sources')}</div>
          </div>
        </div>

        <div className={css.field}>
          <div className={css.fieldLabel}>{t('detail.tags')}</div>
          <TagEditor tags={entry.tags} busy={saving} onChange={(tags) => { save({ tags }) }} t={t} />
        </div>

        <div className={css.field}>
          <label className={css.fieldLabel} htmlFor={`library-status-${entry.id}`}>{t('detail.status')}</label>
          <select
            id={`library-status-${entry.id}`}
            className={css.select}
            value={entry.status}
            disabled={saving}
            onChange={(event) => { save({ status: event.target.value as LibraryStatus }) }}
          >
            {STATUSES.map(status => (
              <option key={status} value={status}>{t(`status.${status}`)}</option>
            ))}
          </select>
        </div>

        <div className={css.field}>
          <label className={css.fieldLabel} htmlFor={`library-note-${entry.id}`}>{t('detail.note')}</label>
          <textarea
            id={`library-note-${entry.id}`}
            className={css.note}
            value={note}
            rows={4}
            placeholder={t('detail.notePlaceholder')}
            onChange={(event) => { setNote(event.target.value) }}
          />
        </div>

        <div className={css.saveState}>
          {saving && <span className={css.saving}>{t('detail.saving')}</span>}
          {!saving && saved && <span className={css.saved}>{t('detail.saved')}</span>}
          {saveError !== null && (
            <span className={css.failure} role="alert">{t('detail.saveFailed', { code: saveError })}</span>
          )}
        </div>

        <div className={css.field}>
          <div className={css.fieldLabel}>{t('detail.files')}</div>
          {entry.files.length === 0
            ? <p className={css.empty}>{t('detail.filesNone')}</p>
            : (
              <div className={css.files}>
                {entry.files.map(file => (
                  <FilePane key={file.name} entryId={entry.id} file={file} readText={readText} t={t} />
                ))}
              </div>
            )}
          <UploadButton
            entryId={entry.id}
            label={t('upload.here')}
            upload={upload}
            onUploaded={onPatched}
            t={t}
          />
        </div>

        <div className={css.actions}>
          {target !== undefined && (
            <a className={css.action} href={target} target="_blank" rel="noreferrer noopener">
              {t('detail.openPdf')}
            </a>
          )}
          <button
            type="button"
            className={css.action}
            onClick={() => {
              void writeClipboard(toBibtex(entry)).then((ok) => { setCopy(ok ? 'copied' : 'failed') })
            }}
          >
            {t('detail.copy')}
          </button>
          {entry.pdfUrl !== undefined && (
            <button
              type="button"
              className={css.action}
              disabled={fetching}
              onClick={() => {
                setFetching(true)
                setFetchError(null)
                void fetchPdf(entry.id).then((outcome) => {
                  setFetching(false)
                  if (outcome.ok) onPatched(outcome.value)
                  else setFetchError(outcome.code)
                })
              }}
            >
              {fetching ? t('detail.fetching') : t('detail.fetchPdf')}
            </button>
          )}
          {confirming
            ? (
              <>
                <button
                  type="button"
                  className={`${css.action} ${css.danger}`}
                  onClick={() => {
                    setRemoveError(null)
                    void remove(entry.id).then((outcome) => {
                      if (outcome.ok) onRemoved(entry.id)
                      else {
                        setConfirming(false)
                        setRemoveError(outcome.code)
                      }
                    })
                  }}
                >
                  {t('detail.removeConfirm')}
                </button>
                <button type="button" className={css.action} onClick={() => { setConfirming(false) }}>
                  {t('detail.removeCancel')}
                </button>
              </>
            )
            : (
              <button
                type="button"
                className={`${css.action} ${css.danger}`}
                onClick={() => { setConfirming(true) }}
              >
                {t('detail.remove')}
              </button>
            )}
          {copy !== 'idle' && (
            <span className={copy === 'copied' ? css.notice : css.failure}>
              {copy === 'copied' ? t('detail.copied') : t('detail.copyFailed')}
            </span>
          )}
          {fetchError !== null && (
            <span className={css.failure} role="alert">{t('detail.fetchFailed', { code: fetchError })}</span>
          )}
          {removeError !== null && (
            <span className={css.failure} role="alert">{t('detail.removeFailed', { code: removeError })}</span>
          )}
        </div>
      </article>

      <div className={css.relatedTitle}>{t('detail.related')}</div>
      {related.length === 0
        ? <p className={css.empty}>{t('detail.relatedNone')}</p>
        : (
          <div className={css.related}>
            {related.map(row => (
              <button
                key={row.id}
                type="button"
                className={css.relatedRow}
                onClick={() => { onOpen(row.id) }}
              >
                <span className={css.relatedTitleText}>{row.title}</span>
                {row.year !== undefined && <span className={css.year}>{row.year}</span>}
              </button>
            ))}
          </div>
        )}
    </div>
  )
}
