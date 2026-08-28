/**
 * Preview dispatch: which renderer one `workspace.readFile` media type gets.
 * The backend derives the media type from the extension and never sniffs
 * content, so this table is the whole decision — an unlisted extension
 * arrives as `application/octet-stream` and lands on the size-only arm.
 */

import { extensionOf } from './paths.ts'

/** The preview renderers this mode ships. */
export type PreviewKind = 'markdown' | 'text' | 'image' | 'pdf' | 'office' | 'binary'

/** Media types the Univer runtime owns; the frame renders them, not a byte read. */
const OFFICE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'application/x-univer',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

/** Non-`text/` media types whose content is still source the code arm shows. */
const TEXT_MEDIA_TYPES: ReadonlySet<string> = new Set(['application/json'])

/**
 * The renderer one media type gets.
 * @param mediaType - the type `workspace.readFile` advertised.
 * @returns the preview arm that handles it.
 */
export function previewKindFor(mediaType: string): PreviewKind {
  if (OFFICE_MEDIA_TYPES.has(mediaType)) return 'office'
  if (mediaType === 'text/markdown') return 'markdown'
  if (mediaType === 'application/pdf') return 'pdf'
  if (mediaType.startsWith('image/')) return 'image'
  if (mediaType.startsWith('text/') || TEXT_MEDIA_TYPES.has(mediaType)) return 'text'
  return 'binary'
}

/**
 * A `src` the browser can render from one already-read file. Base64 content
 * rides the standard payload form; UTF-8 content (SVG is the one such image)
 * is percent-encoded, because a raw markup body would terminate the URL at
 * its first `#`.
 * @param mediaType - the content's media type.
 * @param encoding - how the content carries the bytes.
 * @param content - the complete content in that encoding.
 * @returns a data URL for an `<img>` or an `<embed>`.
 */
export function dataUrl(mediaType: string, encoding: 'utf8' | 'base64', content: string): string {
  return encoding === 'base64'
    ? `data:${mediaType};base64,${content}`
    : `data:${mediaType},${encodeURIComponent(content)}`
}

/**
 * Grammar hint for the code arm's highlighter. The extension without its dot
 * is the fence info string every supported grammar is registered under; an
 * extensionless or unknown file highlights as plain text.
 * @param path - the file's path.
 * @returns the grammar hint, or undefined when there is no extension.
 */
export function highlightLanguage(path: string): string | undefined {
  const extension = extensionOf(path)
  return extension === '' ? undefined : extension.slice(1)
}

/**
 * A byte count as a person reads a file size.
 * @param bytes - the file's byte length.
 * @returns a short size string.
 */
export function formatSize(bytes: number): string {
  const kib = 1024
  const mib = kib * kib
  if (bytes < kib) return `${bytes} B`
  if (bytes < mib) return `${Math.round(bytes / kib)} KB`
  return `${(bytes / mib).toFixed(1)} MB`
}
