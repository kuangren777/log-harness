/**
 * Saving the previewed file to disk. The panel already holds the complete
 * content — `workspace.readFile` refuses an oversized file rather than
 * truncating it — so the download is assembled in the browser from those
 * bytes instead of opening a second route the session cookie would have to
 * authorize.
 */

import type { SciFileContent } from './contract.ts'
import { fileName } from './paths.ts'

/**
 * The raw bytes behind a base64 payload.
 * @param content - base64 text as `workspace.readFile` returned it.
 * @returns the decoded bytes.
 */
export function decodeBase64(content: string): Uint8Array<ArrayBuffer> {
  const binary = atob(content)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * One read file as a blob carrying its own media type. Base64 content is
 * decoded first: handing the encoded text to the Blob would save the
 * transport spelling rather than the file.
 * @param file - the complete file content the preview read.
 * @returns a blob of the file's bytes.
 */
export function toBlob(file: SciFileContent): Blob {
  const parts = file.encoding === 'base64' ? [decodeBase64(file.content)] : [file.content]
  return new Blob(parts, { type: file.mediaType })
}

/**
 * Save one read file through the browser's own download path. The object URL
 * is released immediately after the click: the blob is already owned by the
 * download, and a panel that browses many documents must not retain every one
 * of them.
 * @param file - the complete file content the preview read.
 * @param doc - document owning the transient anchor (injected for tests).
 */
export function triggerDownload(file: SciFileContent, doc: Document = document): void {
  const url = URL.createObjectURL(toBlob(file))
  const anchor = doc.createElement('a')
  anchor.href = url
  anchor.download = fileName(file.path)
  doc.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
