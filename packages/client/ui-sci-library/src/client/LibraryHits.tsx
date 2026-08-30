/**
 * The two library tool rows: what a `library_search` call found, and what a
 * `library_add` call stored.
 *
 * The rendering intent rides the tool result's `meta`, which is host-computed
 * data this package does not own, so every field is validated before it is
 * drawn: a meta of another shape, another kind, or an entries array holding
 * something that is not an entry leaves the seat empty and the generic tool
 * card renders instead. Nothing here is derived from the call arguments — a
 * replay of the same log draws the same rows.
 */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { LibraryEntry, LibraryKind, LibraryStatus } from './contract.ts'
import css from './LibraryHits.module.css'

/** The three kinds an entry may name; anything else is not our meta. */
const KINDS: ReadonlySet<string> = new Set<LibraryKind>(['paper', 'dataset', 'note'])

/** The five statuses an entry may name. */
const STATUSES: ReadonlySet<string> = new Set<LibraryStatus>([
  'unread', 'reading', 'read', 'verified', 'low-confidence',
])

/** Full props of both library tool rows. */
export type LibraryHitsProps = ToolCallViewProps & PropsLocale<'sci-library'>

/**
 * Whether one array element is a library entry these rows can draw.
 * @param value - one element of the meta's entries array.
 * @returns whether every field the rows read is present and well-typed.
 */
function isEntry(value: unknown): value is LibraryEntry {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<LibraryEntry>
  return typeof row.id === 'string'
    && typeof row.title === 'string'
    && typeof row.kind === 'string'
    && KINDS.has(row.kind)
    && typeof row.status === 'string'
    && STATUSES.has(row.status)
    && Array.isArray(row.tags)
    && Array.isArray(row.files)
}

/**
 * The entries one settled call reported, or null when this call carries no
 * library meta at all.
 * @param block - the running or settled call.
 * @returns the validated entries, or null to fall back to the generic card.
 */
export function libraryEntriesOf(block: ToolCallBlock): readonly LibraryEntry[] | null {
  const meta: unknown = 'meta' in block ? block.meta : undefined
  if (typeof meta !== 'object' || meta === null) return null
  const shape = meta as { kind?: unknown; entries?: unknown }
  if (shape.kind !== 'library' || !Array.isArray(shape.entries)) return null
  return shape.entries.filter(isEntry)
}

/**
 * Whether one settled `library_add` call reported the entry as newly created.
 * The host states it; a meta without the flag draws the neutral confirmation
 * rather than claiming either outcome.
 * @param block - the settled call.
 * @returns true, false, or undefined when the host did not say.
 */
export function libraryCreatedOf(block: ToolCallBlock): boolean | undefined {
  const meta: unknown = 'meta' in block ? block.meta : undefined
  if (typeof meta !== 'object' || meta === null) return undefined
  const created: unknown = (meta as { created?: unknown }).created
  return typeof created === 'boolean' ? created : undefined
}

/**
 * Render the hit list of one `library_search` call.
 * @param props - the row's composed slot props.
 * @returns the compact list, or nothing when this call carries no hits.
 */
export function LibraryHits({ block, t }: LibraryHitsProps) {
  const entries = libraryEntriesOf(block)
  if (entries === null || entries.length === 0) return null
  return (
    <div className={css.root}>
      <div className={css.count}>{t('hits.search', { count: entries.length })}</div>
      {entries.map(entry => (
        <div key={entry.id} className={css.row}>
          <span className={css.kind}>{t(`kind.${entry.kind}`)}</span>
          <span className={css.title}>{entry.title}</span>
          {entry.year !== undefined && <span className={css.fact}>{entry.year}</span>}
          <span className={css.fact}>{t(`status.${entry.status}`)}</span>
          {entry.doi !== undefined && <span className={css.doi}>{`doi:${entry.doi}`}</span>}
          {entry.files.length > 0 && (
            <span className={css.fact}>{t('card.files', { count: entry.files.length })}</span>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Render the confirmation of one `library_add` call: the one entry it stored.
 * @param props - the row's composed slot props.
 * @returns the confirmation row, or nothing when the call stored nothing.
 */
export function LibraryAdded({ block, t }: LibraryHitsProps) {
  const entries = libraryEntriesOf(block)
  const entry = entries?.[0]
  if (entry === undefined) return null
  const created = libraryCreatedOf(block)
  const outcome = created === undefined
    ? 'hits.add.stored'
    : created ? 'hits.add.created' : 'hits.add.existing'
  return (
    <div className={css.root}>
      <div className={css.row}>
        <span className={css.kind}>{t(`kind.${entry.kind}`)}</span>
        <span className={css.title}>{entry.title}</span>
        <span className={css.outcome}>{t(outcome)}</span>
      </div>
    </div>
  )
}
