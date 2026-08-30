/**
 * The deterministic confidence score, and nothing else.
 *
 * No model call, no network, no clock: the same signals always produce the same
 * number, which is what lets the score be stored on the row, shown to the user
 * as a reason rather than an opinion, and recomputed identically by any client
 * that wants to check it. Every term is capped on its own and the sum is
 * clamped, so no single signal can carry an entry on its own.
 *
 * The library status is deliberately NOT a term. It is a human's or the model's
 * verdict about the work, so it clamps the computed score afterwards instead of
 * feeding back into it — a `verified` entry reads 100 because someone checked
 * it, not because the arithmetic agreed.
 * @module @deepseek-ai/dsh-sci-citations/src/confidence
 */

import type { ConfidenceInput } from './types.ts'

/** Points for three or more independent sources. */
export const SOURCES_THREE = 45

/** Points for exactly two independent sources. */
export const SOURCES_TWO = 35

/** Points for a single source. */
export const SOURCES_ONE = 15

/** Points for a work some source dated. */
export const YEAR_POINTS = 10

/** Largest contribution the citation count can make. */
export const CITED_BY_MAX = 25

/** Citation count above which the log term saturates. */
export const CITED_BY_CAP = 1000

/** Points for a work some source gave a venue. */
export const VENUE_POINTS = 10

/** Points for a work that is not sourced from arXiv alone. */
export const NOT_ARXIV_ONLY_POINTS = 10

/** Score of an entry that exists only because `refs.bib` names it and has no DOI. */
export const BIB_ONLY_SCORE = 30

/** Ceiling a `low-confidence` library status imposes on the computed score. */
export const LOW_CONFIDENCE_CEILING = 60

/** Library status that pins the score at 100. */
export const STATUS_VERIFIED = 'verified'

/** Library status that caps the score at {@link LOW_CONFIDENCE_CEILING}. */
export const STATUS_LOW_CONFIDENCE = 'low-confidence'

/** The one source name a `refs.bib`-only entry carries. */
export const BIB_SOURCE = 'bib'

/**
 * Points the citation count contributes.
 * @param citedBy - the count a source reported, or `undefined`.
 * @returns `0` when nothing reported a count, else a log-scaled 0..25.
 */
export function citedByPoints(citedBy: number | undefined): number {
  if (citedBy === undefined || citedBy <= 0) return 0
  return Math.min(CITED_BY_MAX, Math.round(CITED_BY_MAX * Math.log10(Math.min(citedBy, CITED_BY_CAP) + 1) / 3))
}

/**
 * Points multi-source agreement contributes.
 * @param sources - every source that vouched for the record.
 * @returns 0, 15, 35, or 45.
 */
export function sourcePoints(sources: readonly string[]): number {
  if (sources.length >= 3) return SOURCES_THREE
  if (sources.length === 2) return SOURCES_TWO
  if (sources.length === 1) return SOURCES_ONE
  return 0
}

/**
 * Whether the only thing vouching for this work is an arXiv preprint.
 * @param sources - every source that vouched for the record.
 * @returns whether `sources` is exactly `['arxiv']`.
 */
export function isArxivOnly(sources: readonly string[]): boolean {
  return sources.length === 1 && sources[0] === 'arxiv'
}

/**
 * Whether the only thing vouching for this work is a line in `refs.bib`.
 * @param sources - every source that vouched for the record.
 * @returns whether `sources` is exactly `['bib']`.
 */
export function isBibOnly(sources: readonly string[]): boolean {
  return sources.length === 1 && sources[0] === BIB_SOURCE
}

/**
 * Score one record's bibliographic signals.
 *
 * The terms are applied in one fixed order and each stage can only be reached
 * by the one before it: the additive formula runs first and is clamped to 100;
 * a `refs.bib`-only entry with no DOI then replaces that score outright,
 * because nothing in the formula's inputs was ever verified for it; and the
 * library status, being a verdict rather than a signal, clamps last.
 * @param input - the signals available for this record.
 * @returns an integer in 0..100.
 */
export function confidence(input: ConfidenceInput): number {
  const additive = sourcePoints(input.sources)
    + (input.year === undefined ? 0 : YEAR_POINTS)
    + citedByPoints(input.citedBy)
    + (input.venue === undefined ? 0 : VENUE_POINTS)
    + (isArxivOnly(input.sources) ? 0 : NOT_ARXIV_ONLY_POINTS)
  const scored = isBibOnly(input.sources) && input.doi === undefined
    ? BIB_ONLY_SCORE
    : Math.min(100, additive)
  if (input.libraryStatus === STATUS_VERIFIED) return 100
  if (input.libraryStatus === STATUS_LOW_CONFIDENCE) return Math.min(scored, LOW_CONFIDENCE_CEILING)
  return scored
}
