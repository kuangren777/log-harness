/**
 * Lexical scoring — the whole of the library's search.
 *
 * The harness carries no embedding provider and no vector store, so "search my
 * library" is term overlap and nothing more. The weights say which field a
 * match is worth most in: a query word in the title is the strongest evidence
 * the user meant this entry, a tag they typed themselves is next, and the
 * abstract and author list are corroboration. Everything here is pure over an
 * in-memory snapshot, which is what a few thousand rows can afford at query
 * time without an index to keep in step with the table.
 * @module @deepseek-ai/dsh-sci-library/src/score
 */

import type { LibraryEntry } from './types.ts'

/** Weight of one query term matching a title word. */
export const TITLE_WEIGHT = 3

/** Weight of one query term matching a tag. */
export const TAG_WEIGHT = 2

/** Weight of one query term matching an abstract word. */
export const ABSTRACT_WEIGHT = 1

/** Weight of one query term matching an author-name word. */
export const AUTHOR_WEIGHT = 1

/** Abstract characters the scorer reads; a long abstract cannot outweigh a title. */
export const SCORED_ABSTRACT_CHARS = 2000

/**
 * Split text into the lowercase terms the scorer compares.
 *
 * Splitting on non-alphanumerics keeps CJK text as one run per character class
 * rather than dropping it, so a Chinese title still yields terms a Chinese
 * query can match.
 * @param text - any field text, possibly empty.
 * @returns the lowercase terms, in order, with empties removed.
 */
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term => term !== '')
}

/**
 * How many of one field's terms are query terms.
 * @param field - the field's terms.
 * @param query - the query's terms, already de-duplicated.
 * @returns the count of field positions a query term matched.
 */
export function overlap(field: readonly string[], query: ReadonlySet<string>): number {
  let matched = 0
  for (const term of field) if (query.has(term)) matched += 1
  return matched
}

/**
 * The terms one entry offers each weighted field.
 * @param entry - the entry to read.
 * @returns the four term lists, in weight order.
 */
export function entryTerms(entry: LibraryEntry): {
  title: string[]
  tags: string[]
  abstract: string[]
  authors: string[]
} {
  return {
    title: tokenize(entry.title),
    tags: entry.tags.flatMap(tag => tokenize(tag)),
    abstract: tokenize((entry.abstract ?? '').slice(0, SCORED_ABSTRACT_CHARS)),
    authors: entry.authors.flatMap(author => tokenize(author)),
  }
}

/**
 * Total ordering over two tags or ids, so every tie-break in this package is
 * decided the same way rather than by three hand-written comparators.
 * @param left - the first value.
 * @param right - the second value.
 * @returns -1, 0, or 1 by code-unit order.
 */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Score one entry against a query.
 * @param entry - the entry to score.
 * @param query - the query's terms; an empty set scores zero.
 * @returns the weighted overlap; zero means no term matched anywhere.
 */
export function scoreEntry(entry: LibraryEntry, query: ReadonlySet<string>): number {
  if (query.size === 0) return 0
  const terms = entryTerms(entry)
  return overlap(terms.title, query) * TITLE_WEIGHT
    + overlap(terms.tags, query) * TAG_WEIGHT
    + overlap(terms.abstract, query) * ABSTRACT_WEIGHT
    + overlap(terms.authors, query) * AUTHOR_WEIGHT
}

/**
 * The de-duplicated term set one query text scores by.
 * @param query - the query text as the caller sent it.
 * @returns the distinct lowercase terms.
 */
export function queryTerms(query: string): ReadonlySet<string> {
  return new Set(tokenize(query))
}

/**
 * Rank entries against a query, dropping the ones nothing matched.
 *
 * Ties order by `updatedAt` descending and then by id, so two entries the query
 * scores identically come back in a stable order rather than in table order.
 * @param entries - the entries to rank.
 * @param query - the query text.
 * @returns the matching entries, best first.
 */
export function rankEntries(entries: readonly LibraryEntry[], query: string): readonly LibraryEntry[] {
  const terms = queryTerms(query)
  const scored: { entry: LibraryEntry; score: number }[] = []
  for (const entry of entries) {
    const score = scoreEntry(entry, terms)
    if (score > 0) scored.push({ entry, score })
  }
  scored.sort((left, right) => right.score - left.score
    || right.entry.updatedAt - left.entry.updatedAt
    || compareText(left.entry.id, right.entry.id))
  return scored.map(item => item.entry)
}

/**
 * Order entries the way a listing with no query shows them.
 * @param entries - the entries to order.
 * @returns the entries newest-updated first; equal timestamps order by id.
 */
export function sortByRecency(entries: readonly LibraryEntry[]): readonly LibraryEntry[] {
  return [...entries].sort((left, right) => right.updatedAt - left.updatedAt
    || compareText(left.id, right.id))
}

/**
 * The neighbours of one entry, by the same lexical score over title and abstract.
 *
 * The subject's own tags are deliberately not part of the query: a tag the user
 * applied to twenty entries would make all twenty each other's neighbours and
 * say nothing about what any of them is about.
 * @param subject - the entry to find neighbours of.
 * @param entries - every entry in the library, including the subject.
 * @param limit - how many neighbours to return.
 * @returns the best-scoring other entries, best first.
 */
export function relatedEntries(
  subject: LibraryEntry,
  entries: readonly LibraryEntry[],
  limit: number,
): readonly LibraryEntry[] {
  const query = `${subject.title} ${subject.abstract ?? ''}`
  return rankEntries(entries.filter(entry => entry.id !== subject.id), query).slice(0, limit)
}
