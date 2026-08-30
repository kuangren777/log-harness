/**
 * The `refs.bib` reader and writer.
 *
 * A hand-written bibliography is not a data format anyone controls: it is
 * whatever the author, their editor, and whichever publisher's export tool
 * produced. So this reader is deliberately partial and deliberately loud — it
 * understands `@type{key, field = {…} | "…" | bare,}` with nested braces, and
 * every block it cannot read becomes one {@link BibParseError} carrying the
 * line it started on rather than failing the file. A pool missing one entry
 * with a visible reason beats a pool that is silently empty.
 *
 * The writer is byte-conservative for the same reason: {@link upsertBibtexEntry}
 * replaces exactly the span of the citekey it is rewriting and appends
 * otherwise, so a file full of comments, `@string` macros, and hand-tuned
 * spacing survives a model writing one entry into it.
 * @module @deepseek-ai/dsh-sci-citations/src/bibtex
 */

import type { BibEntry, BibParseError, BibParseResult } from './types.ts'

/** Entry types that carry no bibliographic record and never enter a pool. */
export const NON_RECORD_TYPES: readonly string[] = ['comment', 'string', 'preamble']

/** Field order {@link formatBibtexEntry} writes; anything else follows, sorted. */
export const BIB_FIELD_ORDER: readonly string[] = [
  'title',
  'author',
  'year',
  'journal',
  'booktitle',
  'publisher',
  'volume',
  'number',
  'pages',
  'doi',
  'eprint',
  'url',
  'note',
]

/** The separator BibTeX joins author names with. */
export const AUTHOR_SEPARATOR = ' and '

/** One parsed entry with the byte span it occupied, for the writer's benefit. */
interface EntrySpan {
  /** The entry itself. */
  entry: BibEntry
  /** Index of the `@` that opened the block. */
  start: number
  /** Index just past the `}` that closed the block. */
  end: number
}

/** Everything one scan of a `.bib` file produced. */
interface ScanResult {
  /** Readable blocks in file order, including `@string`-style non-records. */
  spans: EntrySpan[]
  /** One entry per unreadable block, in file order. */
  errors: BibParseError[]
}

/** A parse that failed at a known offset, carrying what the reader expected. */
class BibSyntaxError extends Error {
  /**
   * @param message - what the reader expected at this point.
   */
  constructor(message: string) {
    super(message)
    this.name = 'BibSyntaxError'
  }
}

/**
 * The 1-based line one offset falls on.
 * @param text - the whole file.
 * @param index - a character offset into it.
 * @returns the line number, counting from 1.
 */
export function lineAt(text: string, index: number): number {
  let line = 1
  for (let cursor = 0; cursor < index && cursor < text.length; cursor += 1) {
    if (text[cursor] === '\n') line += 1
  }
  return line
}

/**
 * Advance past whitespace.
 * @param text - the whole file.
 * @param index - where to start.
 * @returns the first non-whitespace offset at or after `index`.
 */
function skipSpace(text: string, index: number): number {
  let cursor = index
  // charAt, not indexing: it answers '' past the end, which matches nothing,
  // so the walk needs no separate bounds test and no unreachable fallback.
  while (/\s/.test(text.charAt(cursor))) cursor += 1
  return cursor
}

/**
 * Read a run of characters matching a pattern.
 * @param text - the whole file.
 * @param index - where to start.
 * @param pattern - single-character test applied to each candidate.
 * @returns the run and the offset just past it.
 */
function readWhile(text: string, index: number, pattern: RegExp): { value: string; next: number } {
  let cursor = index
  while (pattern.test(text.charAt(cursor))) cursor += 1
  return { value: text.slice(index, cursor), next: cursor }
}

/**
 * Read a `{…}` value, honouring nested braces.
 * @param text - the whole file.
 * @param index - offset of the opening brace.
 * @returns the inner text and the offset just past the closing brace.
 * @throws BibSyntaxError when the braces never balance before end of file.
 */
function readBraced(text: string, index: number): { value: string; next: number } {
  let depth = 0
  for (let cursor = index; cursor < text.length; cursor += 1) {
    const char = text[cursor]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return { value: text.slice(index + 1, cursor), next: cursor + 1 }
    }
  }
  throw new BibSyntaxError('braced value is never closed')
}

/**
 * Read a `"…"` value; braces inside it are balanced but not stripped.
 * @param text - the whole file.
 * @param index - offset of the opening quote.
 * @returns the inner text and the offset just past the closing quote.
 * @throws BibSyntaxError when the quote never closes before end of file.
 */
function readQuoted(text: string, index: number): { value: string; next: number } {
  let depth = 0
  for (let cursor = index + 1; cursor < text.length; cursor += 1) {
    const char = text[cursor]
    if (char === '{') depth += 1
    else if (char === '}') depth -= 1
    else if (char === '"' && depth === 0) return { value: text.slice(index + 1, cursor), next: cursor + 1 }
  }
  throw new BibSyntaxError('quoted value is never closed')
}

/**
 * Read one field value in any of the three accepted forms.
 * @param text - the whole file.
 * @param index - offset of the first value character.
 * @returns the value and the offset just past it.
 * @throws BibSyntaxError for an unterminated delimiter or an empty value.
 */
function readValue(text: string, index: number): { value: string; next: number } {
  const char = text[index]
  if (char === '{') return readBraced(text, index)
  if (char === '"') return readQuoted(text, index)
  const bare = readWhile(text, index, /[^,}\s]/)
  if (bare.value === '') throw new BibSyntaxError('field has no value')
  return bare
}

/**
 * Read the field list of one entry, starting just past the citekey's comma.
 * @param text - the whole file.
 * @param index - offset of the first field name, or of the closing brace.
 * @returns the fields and the offset just past the entry's closing brace.
 * @throws BibSyntaxError for a malformed field or an entry that never closes.
 */
function readFields(text: string, index: number): { fields: Record<string, string>; next: number } {
  const fields: Record<string, string> = {}
  let cursor = index
  for (;;) {
    cursor = skipSpace(text, cursor)
    if (cursor >= text.length) throw new BibSyntaxError('entry is never closed')
    if (text[cursor] === '}') return { fields, next: cursor + 1 }

    const name = readWhile(text, cursor, /[A-Za-z0-9_+:.-]/)
    if (name.value === '') throw new BibSyntaxError('expected a field name')
    cursor = skipSpace(text, name.next)
    if (text[cursor] !== '=') throw new BibSyntaxError(`field "${name.value}" is not followed by "="`)

    const read = readValue(text, skipSpace(text, cursor + 1))
    fields[name.value.toLowerCase()] = read.value
    cursor = skipSpace(text, read.next)
    if (text[cursor] === ',') { cursor += 1; continue }
    if (text[cursor] === '}') return { fields, next: cursor + 1 }
    throw new BibSyntaxError(`field "${name.value}" is not followed by "," or "}"`)
  }
}

/**
 * Split one `author` field into names.
 * @param author - the raw field value, or `undefined` when the entry has none.
 * @returns the names with surrounding whitespace and stray braces removed.
 */
export function splitAuthors(author: string | undefined): string[] {
  if (author === undefined) return []
  return author
    .split(/\s+and\s+/i)
    .map(name => name.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim())
    .filter(name => name !== '')
}

/**
 * Read one entry beginning at an `@`.
 * @param text - the whole file.
 * @param start - offset of the `@`.
 * @returns the entry with its span.
 * @throws BibSyntaxError when the block is not a readable entry.
 */
function readEntry(text: string, start: number): EntrySpan {
  const type = readWhile(text, start + 1, /[A-Za-z]/)
  if (type.value === '') throw new BibSyntaxError('expected an entry type after "@"')
  let cursor = skipSpace(text, type.next)
  if (text[cursor] !== '{') throw new BibSyntaxError(`entry type "${type.value}" is not followed by "{"`)

  const key = readWhile(text, cursor + 1, /[^,}]/)
  cursor = key.next
  if (cursor >= text.length) throw new BibSyntaxError('entry is never closed')
  const trimmedKey = key.value.trim()
  if (text[cursor] === '}') {
    return { entry: { type: type.value.toLowerCase(), key: trimmedKey, fields: {}, authors: [] }, start, end: cursor + 1 }
  }

  const read = readFields(text, cursor + 1)
  return {
    entry: {
      type: type.value.toLowerCase(),
      key: trimmedKey,
      fields: read.fields,
      authors: splitAuthors(read.fields['author']),
    },
    start,
    end: read.next,
  }
}

/**
 * Read every block of one `.bib` file, keeping the span each occupied.
 * @param text - the whole file.
 * @returns the readable blocks and the unreadable ones.
 */
function scanBibtex(text: string): ScanResult {
  const spans: EntrySpan[] = []
  const errors: BibParseError[] = []
  let cursor = 0
  for (;;) {
    const at = text.indexOf('@', cursor)
    if (at === -1) return { spans, errors }
    try {
      const span = readEntry(text, at)
      spans.push(span)
      cursor = span.end
    } catch (error) {
      // readEntry throws BibSyntaxError and nothing else: every failure inside
      // it is a `throw new BibSyntaxError`, and none of the readers it calls
      // allocates, recurses, or touches anything that could raise.
      errors.push({ line: lineAt(text, at), message: (error as BibSyntaxError).message })
      // Resync on the next block rather than the next character: the rest of
      // an unreadable entry is not a second entry, and re-reading it would
      // report the same damage once per field.
      cursor = at + 1
    }
  }
}

/**
 * Read one `refs.bib`.
 * @param text - the whole file.
 * @returns every readable bibliographic entry in file order, and one error per
 *   block that could not be read. `@comment`, `@string`, and `@preamble` blocks
 *   are consumed but never returned: they carry no work.
 */
export function parseBibtex(text: string): BibParseResult {
  const scanned = scanBibtex(text)
  return {
    entries: scanned.spans.map(span => span.entry).filter(entry => !NON_RECORD_TYPES.includes(entry.type)),
    errors: scanned.errors,
  }
}

/**
 * Where one field sorts in a written entry.
 * @param name - the lowercased field name.
 * @returns its position in {@link BIB_FIELD_ORDER}, or one past the end for a
 *   field the order does not name.
 */
function fieldRank(name: string): number {
  const index = BIB_FIELD_ORDER.indexOf(name)
  return index === -1 ? BIB_FIELD_ORDER.length : index
}

/**
 * Render one entry as the block a `.bib` file holds.
 * @param entry - the entry to write; `authors` wins over a stale `author` field.
 * @returns the block, with no trailing newline.
 */
export function formatBibtexEntry(entry: BibEntry): string {
  const fields: Record<string, string> = { ...entry.fields }
  if (entry.authors.length > 0) fields['author'] = entry.authors.join(AUTHOR_SEPARATOR)
  const ordered = Object.entries(fields).sort(([left], [right]) =>
    fieldRank(left) - fieldRank(right) || (left < right ? -1 : 1))
  const lines = ordered.map(([name, value]) => `  ${name} = {${value}},`)
  return [`@${entry.type}{${entry.key},`, ...lines, '}'].join('\n')
}

/**
 * Write one entry into a `.bib` file, replacing the block of the same citekey
 * or appending when the key is new.
 *
 * Every byte outside the replaced span is preserved: comments, `@string`
 * macros, and the file's own spacing all survive.
 * @param text - the current file content; an empty string is a new file.
 * @param entry - the entry to store.
 * @returns the new file content, always ending in a newline.
 */
export function upsertBibtexEntry(text: string, entry: BibEntry): string {
  const block = formatBibtexEntry(entry)
  const existing = scanBibtex(text).spans.find(span => span.entry.key === entry.key)
  if (existing !== undefined) return `${text.slice(0, existing.start)}${block}${text.slice(existing.end)}`
  if (text.trim() === '') return `${block}\n`
  const gap = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
  return `${text}${gap}${block}\n`
}

/**
 * Drop one entry from a `.bib` file.
 * @param text - the current file content.
 * @param key - the citekey to remove; an absent key changes nothing.
 * @returns the new file content, with the removed block's surrounding blank
 *   line collapsed so repeated removals do not leave a growing gap.
 */
export function removeBibtexEntry(text: string, key: string): string {
  const existing = scanBibtex(text).spans.find(span => span.entry.key === key)
  if (existing === undefined) return text
  // The block owned the rest of its own line plus the blank line under it, so
  // both leave with it and repeated removals never grow a hole in the file.
  const tail = text.slice(existing.end).replace(/^[^\S\n]*\n\n?/, '')
  return `${text.slice(0, existing.start)}${tail}`.replace(/\n{2,}$/, '\n')
}
