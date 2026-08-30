/**
 * The file picker that puts one file into the library.
 *
 * The same control serves both sites: on the list it mints a new entry around
 * the file, on a detail page it appends to that entry. Which kind a new entry
 * gets is read off the file itself — a PDF is a paper, anything else is a
 * dataset — so the user picks a file rather than first classifying it.
 *
 * Every outcome the route can produce is stated: an accepted file names
 * itself, a file over the host's limit and a type the host does not accept
 * each say so, and nothing is left claiming to be in flight.
 */
import { useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { LibraryEntry, UploadErrorCode, UploadOutcome, UploadRequest } from './contract.ts'
import type { SciLibraryKey } from './locales.ts'
import css from './UploadButton.module.css'

/** Media type the host stores as a paper; everything else is a dataset. */
const PDF_MEDIA_TYPE = 'application/pdf'

/** What the control is doing, and what the last attempt produced. */
type UploadPhase =
  | { phase: 'idle' }
  | { phase: 'busy' }
  | { phase: 'done'; name: string }
  | { phase: 'error'; code: UploadErrorCode }

/** Owner-controlled picker props. */
export interface UploadButtonProps {
  /** Target entry id, or `new` to mint one around the file. */
  entryId: string
  /** The control's own label. */
  label: string
  /** Send one picked file to the library's upload route. */
  upload: (request: UploadRequest) => Promise<UploadOutcome>
  /** Report the stored entry the route answered with. */
  onUploaded: (entry: LibraryEntry) => void
  /** Localized picker copy. */
  t: Translate<SciLibraryKey>
}

/**
 * Which kind a newly minted entry gets, decided from the picked file.
 * @param file - the file the user picked.
 * @returns `paper` for a PDF, `dataset` otherwise.
 */
export function kindOf(file: File): 'paper' | 'dataset' {
  return file.type === PDF_MEDIA_TYPE ? 'paper' : 'dataset'
}

/**
 * Render the picker and the outcome of its last attempt.
 * @param props - owner-controlled picker props.
 * @returns the control and, once one attempt settled, its stated outcome.
 */
export function UploadButton({ entryId, label, upload, onUploaded, t }: UploadButtonProps) {
  const [state, setState] = useState<UploadPhase>({ phase: 'idle' })
  const busy = state.phase === 'busy'

  const pick = (file: File | undefined): void => {
    if (file === undefined || busy) return
    setState({ phase: 'busy' })
    void upload({ entryId, kind: kindOf(file), file }).then((outcome) => {
      if (outcome.ok) {
        setState({ phase: 'done', name: file.name })
        onUploaded(outcome.entry)
      } else {
        setState({ phase: 'error', code: outcome.code })
      }
    })
  }

  return (
    <div className={css.root}>
      <label className={busy ? `${css.button} ${css.buttonBusy}` : css.button}>
        <span>{busy ? t('upload.busy') : label}</span>
        <input
          className={css.input}
          type="file"
          aria-label={label}
          disabled={busy}
          onChange={(event) => { pick(event.target.files?.[0]) }}
        />
      </label>
      {state.phase === 'done' && (
        <span className={css.done}>{t('upload.done', { name: state.name })}</span>
      )}
      {state.phase === 'error' && (
        <span className={css.error} role="alert">{t(`upload.error.${state.code}`)}</span>
      )}
    </div>
  )
}
