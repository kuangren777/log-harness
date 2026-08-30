/**
 * BibTeX rendering for one library entry.
 *
 * Pure and total: every field comes from the entry, an absent field is left
 * out rather than rendered empty, and the two characters that would break the
 * entry (`{` and `}`) are escaped everywhere they can appear.
 *
 * This package renders its own entries rather than reaching into ②'s: the
 * library holds datasets and notes as well as works, so the entry type is
 * `@misc` for those and `@article` for a paper, and a stored entry carries
 * tags and no guaranteed landing page. The cite-key rule is deliberately the
 * same one ② uses, so a record copied from a search and the same record
 * copied from the library cite identically.
 */

import type { LibraryEntry } from './contract.ts'

/** Fallback year segment of a cite key for an entry whose year is unknown. */
const NO_YEAR = 'n.d.'

/** Fallback cite key when the entry names neither an author nor anything usable. */
const ANONYMOUS = 'anon'

/* jscpd:ignore-start -- the escape and family-name rules are the citation
 * standard's, not this package's: ② renders the same two from its own record
 * type, and the whole point of restating them here is that a record cited
 * from the library and the same record cited from a search must produce
 * byte-identical keys. Sharing them would be a cross-plugin value import. */
/**
 * Escape the two braces TeX reads as grouping.
 * @param value - raw field text.
 * @returns the text with `{`/`}` escaped.
 */
function escapeBraces(value: string): string {
  return value.replace(/([{}])/gu, '\\$1')
}

/**
 * The family name of one author string, reduced to the letters and digits a
 * cite key may carry. A comma means the family name leads; without one the
 * LAST whitespace-separated token is the family name.
 * @param author - author as the source gave it.
 * @returns the normalized family name, empty when nothing survives.
 */
function familyOf(author: string): string {
  const comma = author.indexOf(',')
  const family = comma === -1 ? author.trim().split(/\s+/u).slice(-1).join('') : author.slice(0, comma)
  return family.normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '')
}
/* jscpd:ignore-end */

/**
 * The entry's cite key: the first author's family name joined to the year.
 * @param entry - the entry being cited.
 * @returns the cite key.
 */
export function citeKey(entry: LibraryEntry): string {
  const family = familyOf(entry.authors[0] ?? '')
  return `${family === '' ? ANONYMOUS : family}${entry.year ?? NO_YEAR}`
}

/**
 * Render one library entry as a BibTeX entry: `@article` for a work,
 * `@misc` for a dataset or a note, which is what those actually are.
 * @param entry - the entry being cited.
 * @returns the entry text, newline-separated and brace-closed.
 */
export function toBibtex(entry: LibraryEntry): string {
  const type = entry.kind === 'paper' ? 'article' : 'misc'
  const fields: string[] = [`  title = {${escapeBraces(entry.title)}}`]
  if (entry.authors.length > 0) {
    fields.push(`  author = {${entry.authors.map(escapeBraces).join(' and ')}}`)
  }
  if (entry.venue !== undefined) fields.push(`  journal = {${escapeBraces(entry.venue)}}`)
  if (entry.year !== undefined) fields.push(`  year = {${entry.year}}`)
  if (entry.doi !== undefined) fields.push(`  doi = {${escapeBraces(entry.doi)}}`)
  if (entry.arxivId !== undefined) fields.push(`  eprint = {${escapeBraces(entry.arxivId)}}`)
  if (entry.url !== undefined) fields.push(`  url = {${escapeBraces(entry.url)}}`)
  if (entry.tags.length > 0) {
    fields.push(`  keywords = {${entry.tags.map(escapeBraces).join(', ')}}`)
  }
  return `@${type}{${citeKey(entry)},\n${fields.join(',\n')},\n}`
}
