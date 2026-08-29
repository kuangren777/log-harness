/**
 * BibTeX rendering for one literature record.
 *
 * Pure and total: every field comes from the record, an absent field is left
 * out rather than rendered empty, and the two characters that would break the
 * entry (`{` and `}`) are escaped everywhere they can appear.
 */

import type { LiteratureRecord } from './contract.ts'

/** Fallback year segment of a cite key for a record whose year is unknown. */
const NO_YEAR = 'n.d.'

/** Fallback cite key when the record names neither an author nor anything usable. */
const ANONYMOUS = 'anon'

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
 * cite key may carry.
 *
 * The four sources disagree on order: OpenAlex and Semantic Scholar give
 * display order ("Ruiqiang Guo"), Crossref and arXiv often give inverted
 * order ("Guo, Ruiqiang"). A comma therefore means the family name leads, and
 * without one the LAST whitespace-separated token is the family name — taking
 * the first token would key the entry on the given name.
 * @param author - author as the source gave it.
 * @returns the normalized family name, empty when nothing survives.
 */
function familyOf(author: string): string {
  const comma = author.indexOf(',')
  // `slice(-1).join('')` rather than an index: split always yields at least
  // one element, so this is the last token with no impossible absent case.
  const family = comma === -1 ? author.trim().split(/\s+/u).slice(-1).join('') : author.slice(0, comma)
  return family.normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * The entry's cite key: the first author's family name joined to the year.
 * @param record - the record being cited.
 * @returns the cite key.
 */
export function citeKey(record: LiteratureRecord): string {
  const family = familyOf(record.authors[0] ?? '')
  return `${family === '' ? ANONYMOUS : family}${record.year ?? NO_YEAR}`
}

/**
 * Render one record as a BibTeX `@article` entry.
 * @param record - the record being cited.
 * @returns the entry text, newline-separated and brace-closed.
 */
export function toBibtex(record: LiteratureRecord): string {
  const fields: string[] = [`  title = {${escapeBraces(record.title)}}`]
  if (record.authors.length > 0) {
    fields.push(`  author = {${record.authors.map(escapeBraces).join(' and ')}}`)
  }
  if (record.venue !== undefined) fields.push(`  journal = {${escapeBraces(record.venue)}}`)
  if (record.year !== undefined) fields.push(`  year = {${record.year}}`)
  if (record.doi !== undefined) fields.push(`  doi = {${escapeBraces(record.doi)}}`)
  if (record.arxivId !== undefined) fields.push(`  eprint = {${escapeBraces(record.arxivId)}}`)
  fields.push(`  url = {${escapeBraces(record.url)}}`)
  return `@article{${citeKey(record)},\n${fields.join(',\n')},\n}`
}
