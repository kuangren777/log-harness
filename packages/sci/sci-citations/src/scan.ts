/**
 * Counting what the manuscript actually cites.
 *
 * "Cited N times" is the one number in the pool that cannot be asserted — it
 * has to be read out of the files. So this module is a text scan over the real
 * `.md` and `.tex` content, not a projection of what some turn claimed to
 * write, and a citekey nobody wrote reads `0` rather than going missing.
 *
 * Four spellings are recognized, because the profile writes in two languages:
 * `\cite{a,b}`, `\citep{…}`, and `\citet{…}` in LaTeX, and `` `[key]` `` or
 * bare `[key]` in Markdown. The alternation is ordered so a backticked mention
 * consumes its own brackets and is never counted twice.
 * @module @deepseek-ai/dsh-sci-citations/src/scan
 */

import type { ScannedFile } from './types.ts'

/**
 * Every citation spelling, in the order a left-to-right scan must try them.
 *
 * Group 1 is the comma-joined key list of a LaTeX command, group 2 the key of
 * an inline-code mention, group 3 the key of a bare bracket. The optional
 * `[…]` runs before the brace absorb `\cite[p. 5]{key}`-style page notes.
 */
export const CITATION_PATTERN =
  /\\cite[tp]?\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}|`\[([^\]\s]+)\]`|\[([^\]\s]+)\]/g

/**
 * Every citekey one text mentions, in occurrence order and with repeats kept.
 * @param text - the file content.
 * @returns one entry per mention; a `\cite{a,b}` yields two.
 */
export function mentionedCitekeys(text: string): string[] {
  const found: string[] = []
  // A fresh regex per call: the shared literal carries `g`, so reusing it
  // across files would resume from the previous file's lastIndex.
  const pattern = new RegExp(CITATION_PATTERN.source, 'g')
  for (;;) {
    const match = pattern.exec(text)
    if (match === null) return found
    const joined = match[1]
    if (joined !== undefined) {
      for (const key of joined.split(',')) {
        const trimmed = key.trim()
        if (trimmed !== '') found.push(trimmed)
      }
      continue
    }
    // One of the two bracket alternatives matched whenever group 1 did not.
    found.push((match[2] ?? match[3]) as string)
  }
}

/**
 * Count in-text uses of each citekey across a set of files.
 * @param files - the files the scan read, in any order.
 * @param citekeys - the keys to count; a key nobody mentioned reports `0`.
 * @returns one entry per requested citekey, so a caller never has to
 *   distinguish "not scanned" from "never cited".
 */
export function countUses(
  files: readonly ScannedFile[],
  citekeys: readonly string[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const citekey of citekeys) counts[citekey] = 0
  for (const file of files) {
    for (const mention of mentionedCitekeys(file.text)) {
      // The seeded record is also the membership test: a key absent from it is
      // one the caller did not ask about, which the manuscript may well cite.
      const current = counts[mention]
      if (current === undefined) continue
      counts[mention] = current + 1
    }
  }
  return counts
}
