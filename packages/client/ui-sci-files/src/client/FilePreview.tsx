/**
 * The preview pane: one file, rendered by what it is.
 *
 * Office documents are routed on the path before any read happens — their
 * bytes are a SQLite container or an archive, and the runtime streams them to
 * the frame instead. Everything else is read whole (the RPC refuses an
 * oversized file rather than truncating it) and dispatched on the media type
 * the backend derived from the extension.
 */
import { useEffect, useState } from 'react'
import { CodeBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReactNode } from 'react'
import type { FileReadOutcome, OfficeStateOutcome, SciFileContent } from './contract.ts'
import type { SciFilesKey } from './locales.ts'
import { OfficeFrame } from './OfficeFrame.tsx'
import { decodeBase64 } from './download.ts'
import { dataUrl, formatSize, highlightLanguage, previewKindFor } from './media.ts'
import { fileName, isConvertibleOfficePath, isOfficePath } from './paths.ts'
import css from './FilePreview.module.css'

/** Owner-supplied preview props: the file to show and the two wire calls. */
export interface FilePreviewProps {
  /** Session whose project directory scopes the path. */
  sessionId: SessionId
  /** The file to show, or undefined when nothing is selected yet. */
  path: string | undefined
  /** Read one file's complete content. */
  readFile: (sessionId: SessionId, path: string) => Promise<FileReadOutcome>
  /** Read one office document's collaboration state. */
  officeState: (sessionId: SessionId, path: string) => Promise<OfficeStateOutcome>
  /**
   * Publish the bytes this pane read, so the panel header, the source view,
   * and the download work from the same read instead of asking for a second
   * one. Null while nothing was read: no selection, an office document the
   * runtime streams instead, or a read that failed.
   */
  onFile?: ((file: SciFileContent | null) => void) | undefined
  /** Localized preview copy. */
  t: Translate<SciFilesKey>
}

/**
 * Render the selected file.
 * @param props - owner-controlled preview props.
 * @returns the preview element for the current selection.
 */
export function FilePreview({ sessionId, path, readFile, officeState, onFile, t }: FilePreviewProps) {
  const read = path !== undefined && !isOfficePath(path)
  // A selection with no read to make still reports, so a header left over
  // from the previous file does not describe this one.
  useEffect(() => {
    if (!read) onFile?.(null)
  }, [read, path, onFile])

  if (path === undefined) return <div className={css.note}>{t('preview.none')}</div>
  if (isOfficePath(path)) {
    return <OfficeFrame sessionId={sessionId} path={path} officeState={officeState} t={t} />
  }
  // Keyed by path so a new selection starts from the loading state instead of
  // showing the previous file's bytes until the next read settles.
  return <ReadPreview
    key={path} sessionId={sessionId} path={path}
    readFile={readFile} officeState={officeState} onFile={onFile} t={t}
  />
}

/** The read-and-dispatch half, mounted per selected non-office path. */
function ReadPreview({ sessionId, path, readFile, officeState, onFile, t }: FilePreviewProps & { path: string }) {
  const [outcome, setOutcome] = useState<FileReadOutcome | null>(null)

  useEffect(() => {
    let live = true
    onFile?.(null)
    void readFile(sessionId, path).then((next) => {
      if (!live) return
      setOutcome(next)
      onFile?.(next.ok ? next.file : null)
    })
    return () => { live = false }
  }, [sessionId, path, readFile, onFile])

  if (outcome === null) return <div className={css.note}>{t('preview.loading')}</div>
  if (!outcome.ok) return <div className={css.note} role="alert">{t(`preview.error.${outcome.code}`)}</div>
  return <FileBody file={outcome.file} sessionId={sessionId} officeState={officeState} t={t} />
}

/** One read file, rendered by its media type. */
function FileBody({ file, sessionId, officeState, t }: {
  file: SciFileContent
  sessionId: SessionId
  officeState: (sessionId: SessionId, path: string) => Promise<OfficeStateOutcome>
  t: Translate<SciFilesKey>
}) {
  const kind = previewKindFor(file.mediaType)
  if (kind === 'office') {
    return <OfficeFrame sessionId={sessionId} path={file.path} officeState={officeState} t={t} />
  }
  if (kind === 'markdown') {
    return <div className={css.prose}><MarkdownText text={file.content} /></div>
  }
  return (
    <div className={css.body}>
      <div className={css.meta}>{t('preview.size', { size: formatSize(file.size), mediaType: file.mediaType })}</div>
      {renderTyped(kind, file, t)}
      {/* An office format the Viewer cannot open directly says how it becomes
          openable, instead of dead-ending in a runtime-unavailable notice. */}
      {isConvertibleOfficePath(file.path) && (
        <div className={css.note}>{t('preview.officeConvert')}</div>
      )}
    </div>
  )
}

/** The body of every media type that carries the size line above it. */
function renderTyped(
  kind: 'text' | 'image' | 'pdf' | 'binary',
  file: SciFileContent,
  t: Translate<SciFilesKey>,
): ReactNode {
  if (kind === 'text') {
    return <CodeBlock code={file.content} lang={highlightLanguage(file.path)} />
  }
  if (kind === 'image') {
    return <img className={css.image} src={dataUrl(file.mediaType, file.encoding, file.content)} alt={fileName(file.path)} />
  }
  if (kind === 'pdf') return <PdfFrame file={file} />
  return <div className={css.note}>{t('preview.binary')}</div>
}

/**
 * A PDF in the browser's own viewer. The bytes ride a blob URL rather than a
 * data URL because Chromium refuses to hand a `data:` payload to the PDF
 * plugin; the object URL is revoked with the frame so a panel that browses
 * many documents does not retain every one of them.
 */
function PdfFrame({ file }: { file: SciFileContent }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const blob = new Blob([decodeBase64(file.content)], { type: file.mediaType })
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => { URL.revokeObjectURL(objectUrl) }
  }, [file.content, file.mediaType])

  if (url === null) return null
  return <embed className={css.pdf} type={file.mediaType} src={url} />
}
