/**
 * The `citations_add` tool row: one confirmation line for the citation the
 * call put into the pool.
 *
 * The line states only what the validated `result.meta` carries, so a call
 * whose host reported no confidence or no group says nothing about either.
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { confidenceTone } from './pool-view.ts'
import { addedCitationOf, metaGroupLabel } from './tool-meta.ts'
import css from './ToolRows.module.css'

/** Full props of the citation-added row. */
export type CitationAddedProps = ToolCallViewProps & PropsLocale<'sci-citations'>

/**
 * Render the confirmation of one `citations_add` call.
 * @param props - the row's composed slot props.
 * @returns the confirmation line, or nothing when this call added none.
 */
export function CitationAdded({ block, t }: CitationAddedProps) {
  const row = addedCitationOf(block)
  if (row === null) return null
  const group = metaGroupLabel(row.group, t)
  return (
    <div className={css.root}>
      <div className={css.count}>{t('added.title')}</div>
      <div className={css.row}>
        <span className={css.citekey}>{`[${row.citekey}]`}</span>
        <span className={css.title}>{row.title}</span>
        {row.year !== undefined && <span className={css.fact}>{row.year}</span>}
        {group !== undefined && <span className={css.fact}>{group}</span>}
        {row.confidence !== undefined && (
          <span className={`${css.fact} ${css[confidenceTone(row.confidence)]}`}>
            {t('row.confidence', { value: row.confidence })}
          </span>
        )}
        {row.quarantined && <span className={css.quarantine}>{t('row.quarantined')}</span>}
      </div>
    </div>
  )
}
