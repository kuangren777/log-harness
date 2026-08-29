/**
 * The `literature_search` tool row: the call's hits as a compact list inside
 * the conversation.
 *
 * The rendering intent rides the tool result's `meta`, which is host-computed
 * data this package does not own, so every field is validated before it is
 * drawn: a meta of another shape, another kind, or a records array holding
 * something that is not a record leaves the seat empty and the generic tool
 * card renders instead. Nothing here is derived from the arguments — a replay
 * of the same log draws the same rows.
 */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { LiteratureRecord, LiteratureSource } from './contract.ts'
import css from './LiteratureHits.module.css'

/** The four sources a record may name; anything else is not our meta. */
const SOURCES: ReadonlySet<string> = new Set<LiteratureSource>([
  'openalex', 'semanticscholar', 'arxiv', 'crossref',
])

/** Full props of the literature tool row. */
export type LiteratureHitsProps = ToolCallViewProps & PropsLocale<'sci-search'>

/**
 * Whether one array element is a literature record this row can draw.
 * @param value - one element of the meta's records array.
 * @returns whether every field the row reads is present and well-typed.
 */
function isRecord(value: unknown): value is LiteratureRecord {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<LiteratureRecord>
  return typeof row.id === 'string'
    && typeof row.title === 'string'
    && typeof row.url === 'string'
    && typeof row.source === 'string'
    && SOURCES.has(row.source)
}

/**
 * The records one settled call reported, or null when this call carries no
 * literature meta at all.
 * @param block - the running or settled call.
 * @returns the validated records, or null to fall back to the generic card.
 */
export function literatureRecordsOf(block: ToolCallBlock): readonly LiteratureRecord[] | null {
  const meta: unknown = 'meta' in block ? block.meta : undefined
  if (typeof meta !== 'object' || meta === null) return null
  const shape = meta as { kind?: unknown; records?: unknown }
  if (shape.kind !== 'literature' || !Array.isArray(shape.records)) return null
  return shape.records.filter(isRecord)
}

/**
 * Render the hit list of one `literature_search` call.
 * @param props - the row's composed slot props.
 * @returns the compact list, or nothing when this call carries no hits.
 */
export function LiteratureHits({ block, t }: LiteratureHitsProps) {
  const records = literatureRecordsOf(block)
  if (records === null || records.length === 0) return null
  return (
    <div className={css.root}>
      <div className={css.count}>{t('hits.title', { count: records.length })}</div>
      {records.map(record => (
        <div key={record.id} className={css.row}>
          <span className={css.source}>{t(`source.${record.source}`)}</span>
          <a className={css.title} href={record.url} target="_blank" rel="noreferrer noopener">
            {record.title}
          </a>
          {record.year !== undefined && <span className={css.fact}>{record.year}</span>}
          {record.citedBy !== undefined && (
            <span className={css.fact}>{t('card.citedBy', { count: record.citedBy })}</span>
          )}
          {record.doi !== undefined && <span className={css.doi}>{`doi:${record.doi}`}</span>}
        </div>
      ))}
    </div>
  )
}
