/**
 * One stored file: its row, and the preview the row can open.
 *
 * Bytes come from the library's own file route, never from a workspace read:
 * `LibraryFile.path` is relative to the host's library root and the browser is
 * never told that root, so there is no absolute sandbox path to read. That
 * turns out to be the better route anyway — a PDF and an image are addresses
 * the browser renders itself, and only source has to cross the page as text.
 *
 * A file the browser cannot render inline, or one above the inline cap, keeps
 * its download and offers no preview button rather than opening an empty pane.
 */
import { useEffect, useState } from 'react'
import { CodeBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { FileTextOutcome, LibraryFile } from './contract.ts'
import type { SciLibraryKey } from './locales.ts'
import { fileUrl } from './routes.ts'
import { formatSize, highlightLanguage, isPreviewable, previewKindFor } from './preview.ts'
import css from './FilePane.module.css'

/** Owner-controlled file-row props. */
export interface FilePaneProps {
  /** The entry owning the file. */
  entryId: string
  /** The stored file. */
  file: LibraryFile
  /** Read one stored file as text, for the arms that show source. */
  readText: (entryId: string, name: string) => Promise<FileTextOutcome>
  /** Localized file copy. */
  t: Translate<SciLibraryKey>
}

/**
 * Render one file row and, once opened, its preview.
 * @param props - owner-controlled file-row props.
 * @returns the row.
 */
export function FilePane({ entryId, file, readText, t }: FilePaneProps) {
  const [open, setOpen] = useState(false)
  const previewable = isPreviewable(file)
  const url = fileUrl(entryId, file.name)

  return (
    <div className={css.row}>
      <div className={css.head}>
        <span className={css.name}>{file.name}</span>
        <span className={css.meta}>
          {t('file.meta', { size: formatSize(file.size), mediaType: file.mediaType })}
        </span>
        {previewable && (
          <button
            type="button"
            className={css.action}
            onClick={() => { setOpen(!open) }}
          >
            {open ? t('detail.previewHide') : t('detail.preview')}
          </button>
        )}
        <a className={css.action} href={url} download={file.name}>{t('detail.download')}</a>
      </div>
      {open && <Preview entryId={entryId} file={file} readText={readText} t={t} />}
    </div>
  )
}

/** The opened preview of one file, mounted only while the row is open. */
function Preview({ entryId, file, readText, t }: FilePaneProps) {
  const kind = previewKindFor(file.mediaType)
  const url = fileUrl(entryId, file.name)
  if (kind === 'pdf') {
    return <embed className={css.pdf} type={file.mediaType} src={url} title={t('preview.pdf', { name: file.name })} />
  }
  if (kind === 'image') {
    return <img className={css.image} src={url} alt={file.name} />
  }
  return <SourcePreview entryId={entryId} file={file} readText={readText} t={t} markdown={kind === 'markdown'} />
}

/** The two text arms, which have to fetch the bytes before they can draw. */
function SourcePreview({ entryId, file, readText, markdown, t }: FilePaneProps & { markdown: boolean }) {
  const [outcome, setOutcome] = useState<FileTextOutcome | null>(null)

  useEffect(() => {
    let live = true
    void readText(entryId, file.name).then((next) => { if (live) setOutcome(next) })
    return () => { live = false }
  }, [entryId, file.name, readText])

  if (outcome === null) return <div className={css.note}>{t('preview.loading')}</div>
  if (!outcome.ok) {
    return <div className={css.note} role="alert">{t('preview.failed', { code: outcome.code })}</div>
  }
  return markdown
    ? <div className={css.prose}><MarkdownText text={outcome.text} /></div>
    : <div className={css.source}><CodeBlock code={outcome.text} lang={highlightLanguage(file.name)} /></div>
}
