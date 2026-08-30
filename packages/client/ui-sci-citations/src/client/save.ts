/**
 * The two browser hand-offs the header's buttons make: the clipboard and the
 * download path.
 *
 * Both are total. A browser without the clipboard API (an insecure origin, an
 * old engine) and a document that refuses an object URL both answer `false`,
 * so the header states the outcome instead of throwing inside a click.
 */

/** Media type a `.bib` file is saved under. */
const BIBTEX_MEDIA_TYPE = 'application/x-bibtex'

/**
 * Write text to the system clipboard through the browser's own API.
 * @param text - the citation block.
 * @returns whether the clipboard took it.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  // Read through an optional property: a browser without the API must reach
  // the notice, not a throw.
  const { clipboard } = navigator as { clipboard?: Clipboard }
  if (clipboard === undefined) return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Save one text payload through the browser's own download path.
 *
 * The object URL is released immediately after the click: the blob is already
 * owned by the download, and a view that exports several projects in a row
 * must not retain every one of them.
 * @param name - file name to save under.
 * @param text - the file's content.
 * @param doc - document owning the transient anchor (injected for tests).
 * @returns whether the download was handed to the browser.
 */
export function downloadText(name: string, text: string, doc: Document = document): boolean {
  // Probed through `typeof`, not destructured: an engine without the object-URL
  // factory must reach the notice, and both calls stay bound to `URL`.
  if (typeof URL.createObjectURL !== 'function') return false
  const url = URL.createObjectURL(new Blob([text], { type: BIBTEX_MEDIA_TYPE }))
  const anchor = doc.createElement('a')
  anchor.href = url
  anchor.download = name
  doc.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return true
}
