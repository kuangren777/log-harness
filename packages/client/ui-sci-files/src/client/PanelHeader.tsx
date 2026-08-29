/**
 * The details column's header while the files mode shows: what the selected
 * file is, how to read it, and the three panel gestures.
 *
 * Everything drawn here has a source. The badge and the name come from the
 * path, which exists for every selection; the size line comes from the read,
 * which office documents never make (the runtime streams them to the frame),
 * so it is absent rather than guessed. Source view and download need those
 * same bytes, so both are inert until a read has landed.
 */
import { IconCloseOutline16, IconDownloadOutline16, IconFullscreenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { SciFileContent } from './contract.ts'
import type { SciFilesKey } from './locales.ts'
import { formatSize } from './media.ts'
import { extensionOf, fileName } from './paths.ts'
import css from './PanelHeader.module.css'

/** Which reading of the selected file the panel body shows. */
export type PanelView = 'preview' | 'source'

/** Longest badge the 29px square holds without shrinking its text. */
const BADGE_MAX = 4

/**
 * Extension -> badge color family. The families are the document kinds a
 * research workspace produces; anything else shares the neutral one.
 */
const EXT_FAMILY: Readonly<Record<string, string>> = {
  '.md': 'Doc',
  '.markdown': 'Doc',
  '.txt': 'Doc',
  '.json': 'Doc',
  '.pdf': 'Pdf',
  '.xlsx': 'Sheet',
  '.csv': 'Sheet',
  '.docx': 'Word',
  '.univer': 'Word',
  '.pptx': 'Slides',
  '.png': 'Image',
  '.jpg': 'Image',
  '.jpeg': 'Image',
  '.gif': 'Image',
  '.svg': 'Image',
  '.webp': 'Image',
}

/** Owner-controlled header props: the selection, the reading, and the gestures. */
export interface PanelHeaderProps {
  /** The selected path, or undefined while nothing is selected. */
  path: string | undefined
  /** The bytes the preview read, or null when no read produced any. */
  file: SciFileContent | null
  /** The reading the body currently shows. */
  view: PanelView
  /** Whether this file has a source reading to switch to. */
  canSource: boolean
  /** Switch the body's reading. */
  onView: (view: PanelView) => void
  /** Toggle the wide details mode. */
  onWide: () => void
  /** Save the read bytes to disk; only reachable once a read has landed. */
  onDownload: (file: SciFileContent) => void
  /** Close the details column. */
  onClose: () => void
  /** Localized header copy. */
  t: Translate<SciFilesKey>
}

/**
 * Render the files-mode panel header.
 * @param props - owner-controlled header props.
 * @returns the header row.
 */
export function PanelHeader({ path, file, view, canSource, onView, onWide, onDownload, onClose, t }: PanelHeaderProps) {
  const extension = path === undefined ? '' : extensionOf(path)
  const name = path === undefined ? t('panel.empty') : fileName(path)
  return (
    <div className={css.root}>
      <span className={`${css.badge} ${css[`badge${EXT_FAMILY[extension] ?? 'Other'}`] as string}`} aria-hidden="true">
        {badgeText(extension, name)}
      </span>
      <div className={css.identity}>
        <div className={css.name} title={path}>{name}</div>
        {file !== null && (
          <div className={css.meta}>{t('preview.size', { size: formatSize(file.size), mediaType: file.mediaType })}</div>
        )}
      </div>
      <div className={css.segmented} role="group">
        <button
          type="button" className={css.segment} aria-pressed={view === 'preview'}
          onClick={() => { onView('preview') }}
        >
          {t('panel.preview')}
        </button>
        <button
          type="button" className={css.segment} aria-pressed={view === 'source'} disabled={!canSource}
          onClick={() => { onView('source') }}
        >
          {t('panel.source')}
        </button>
      </div>
      <div className={css.actions}>
        <button type="button" className={css.action} title={t('panel.wide')} aria-label={t('panel.wide')} onClick={onWide}>
          <IconFullscreenOutline16 size={14} />
        </button>
        <button
          type="button" className={css.action} title={t('panel.download')} aria-label={t('panel.download')}
          disabled={file === null} onClick={file === null ? undefined : () => { onDownload(file) }}
        >
          <IconDownloadOutline16 size={14} />
        </button>
        <button type="button" className={css.action} title={t('panel.close')} aria-label={t('panel.close')} onClick={onClose}>
          <IconCloseOutline16 size={14} />
        </button>
      </div>
    </div>
  )
}

/**
 * The badge's letters: the extension when there is one, otherwise the head of
 * the file's own name, so an extensionless file still reads as itself.
 * @param extension - the lowercased extension, dot included, or ''.
 * @param name - the file's base name.
 * @returns up to four uppercase characters.
 */
function badgeText(extension: string, name: string): string {
  const source = extension === '' ? name : extension.slice(1)
  return source.slice(0, BADGE_MAX).toUpperCase()
}
