/**
 * What the detail page can show of one stored file, decided from the media
 * type the host recorded when it wrote the file.
 *
 * The library's own decision, not the files panel's: bytes come from the
 * library's file route rather than from `workspace.readFile`, so there is no
 * office container to route around and no read cap to negotiate — a PDF and
 * an image are addresses the browser renders by itself, source is fetched as
 * text, and everything else is a download.
 */

import type { LibraryFile } from './contract.ts'

/** How one stored file is shown. */
export type PreviewKind = 'markdown' | 'text' | 'image' | 'pdf' | 'binary'

/** Bytes in one KiB. */
const KIB = 1024

/** Bytes in one MiB. */
const MIB = KIB * KIB

/**
 * Largest file the detail page renders inline. Above it the row offers the
 * download only: the bytes would have to cross the page to draw one preview,
 * and a dataset in the library is routinely larger than that is worth.
 */
export const PREVIEW_MAX_BYTES = 8 * MIB

/** Non-`text/` media types whose bytes are still source the code arm shows. */
const SOURCE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'application/json',
  'application/x-ndjson',
])

/**
 * How one media type is shown.
 * @param mediaType - the type the host recorded for the file.
 * @returns the arm that renders it.
 */
export function previewKindFor(mediaType: string): PreviewKind {
  if (mediaType === 'text/markdown') return 'markdown'
  if (mediaType === 'application/pdf') return 'pdf'
  if (mediaType.startsWith('image/')) return 'image'
  if (mediaType.startsWith('text/') || SOURCE_MEDIA_TYPES.has(mediaType)) return 'text'
  return 'binary'
}

/**
 * Whether one file has an inline rendering at all: a shown arm, and bytes
 * within the inline cap.
 * @param file - the stored file.
 * @returns whether the detail page offers a preview for it.
 */
export function isPreviewable(file: LibraryFile): boolean {
  return previewKindFor(file.mediaType) !== 'binary' && file.size <= PREVIEW_MAX_BYTES
}

/**
 * Grammar hint for the source arm's highlighter: the extension without its
 * dot, which is the info string every registered grammar is named by.
 * @param name - the file's name.
 * @returns the hint, or undefined for an extensionless name.
 */
export function highlightLanguage(name: string): string | undefined {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? undefined : name.slice(dot + 1).toLowerCase()
}

/**
 * A byte count as a person reads a file size.
 * @param bytes - the file's byte length.
 * @returns a short size string.
 */
export function formatSize(bytes: number): string {
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(1)} MB`
  if (bytes >= KIB) return `${Math.round(bytes / KIB)} KB`
  return `${bytes} B`
}
