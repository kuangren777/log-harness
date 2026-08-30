/**
 * Minting a citekey, and never re-minting one.
 *
 * `sci-paper`'s contract is that a citekey never changes once the manuscript
 * cites it, so the only moment this module runs is the first `add` of a work
 * the caller named no key for. Everything here is therefore pure and total: a
 * work with no author and no year still gets a key, because refusing to mint
 * one would leave the model with nothing to write in `\cite{}`.
 * @module @deepseek-ai/dsh-sci-citations/src/citekey
 */

/** Family name used when no author is known. */
export const ANONYMOUS_FAMILY = 'anon'

/** Year token used when no source dated the work. */
export const UNDATED_YEAR = 'nd'

/** Letters the de-duplication suffix is drawn from. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'

/**
 * The family name of one author, folded to a citekey-safe token.
 *
 * `"Family, Given"` and `"Given Family"` are both accepted because both forms
 * reach this layer: BibTeX prefers the first, every web index returns the
 * second. Diacritics are decomposed and dropped rather than transliterated —
 * `Serrano-Sánchez` becomes `serranosanchez`, which is stable and typeable,
 * and no citekey has ever needed to be a correct spelling of a name.
 * @param author - one author name in either form.
 * @returns the folded family name, or `''` when the name held no letters.
 */
export function familyName(author: string): string {
  const comma = author.indexOf(',')
  const words = author.trim().split(/\s+/)
  // split always yields at least one element, which noUncheckedIndexedAccess
  // cannot see; the assertion states that rather than inventing a fallback.
  const raw = comma === -1 ? (words[words.length - 1] as string) : author.slice(0, comma)
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * The citekey a work would get before de-duplication.
 * @param authors - the author list, first author first.
 * @param year - the publication year, when a source dated the work.
 * @returns `<family><year>`, with `anon` and `nd` standing in for what is missing.
 */
export function citekeyBase(authors: readonly string[], year: number | undefined): string {
  const family = familyName(authors[0] ?? '')
  return `${family === '' ? ANONYMOUS_FAMILY : family}${year ?? UNDATED_YEAR}`
}

/**
 * The de-duplication suffix at one position.
 * @param index - 0-based position; `0` is `a`.
 * @returns the bijective base-26 token: `a`…`z`, then `aa`…`az`, `ba`, and so on.
 */
export function citekeySuffix(index: number): string {
  let remaining = index
  let suffix = ''
  do {
    suffix = `${ALPHABET[remaining % ALPHABET.length] as string}${suffix}`
    remaining = Math.floor(remaining / ALPHABET.length) - 1
  } while (remaining >= 0)
  return suffix
}

/**
 * The first citekey built on `base` that nobody has taken.
 * @param base - the key {@link citekeyBase} produced.
 * @param taken - every citekey the project already holds.
 * @returns `base` itself when it is free, else `base` plus the first free suffix.
 */
export function uniqueCitekey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let index = 0; ; index += 1) {
    const candidate = `${base}${citekeySuffix(index)}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Fold one caller-supplied citekey into the characters BibTeX accepts.
 * @param citekey - the key as the caller wrote it.
 * @returns the key with whitespace, commas, and braces removed.
 */
export function normalizeCitekey(citekey: string): string {
  return citekey.trim().replace(/[\s,{}"@\\]/g, '')
}
