/**
 * The `citations_list` tool row: the call's pool listing as a compact table
 * inside the conversation.
 *
 * Every column is read off the validated `result.meta`; a citation whose meta
 * carries no year, group, use count, or confidence loses that cell rather
 * than showing a placeholder.
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { confidenceTone } from './pool-view.ts'
import { citationRowsOf, metaGroupLabel } from './tool-meta.ts'
import css from './ToolRows.module.css'

/** Full props of the citation listing row. */
export type CitationsTableProps = ToolCallViewProps & PropsLocale<'sci-citations'>

/**
 * Render the listing of one `citations_list` call.
 * @param props - the row's composed slot props.
 * @returns the compact table, or nothing when this call carries no listing.
 */
export function CitationsTable({ block, t }: CitationsTableProps) {
  const rows = citationRowsOf(block)
  if (rows === null || rows.length === 0) return null
  return (
    <div className={css.root}>
      <div className={css.count}>{t('list.title', { count: rows.length })}</div>
      <table className={css.table}>
        <thead>
          <tr>
            <th scope="col" className={`${css.cell} ${css.head}`}>{t('list.citekey')}</th>
            <th scope="col" className={`${css.cell} ${css.head}`}>{t('list.head.title')}</th>
            <th scope="col" className={`${css.cell} ${css.head}`}>{t('list.head.year')}</th>
            <th scope="col" className={`${css.cell} ${css.head}`}>{t('list.head.group')}</th>
            <th scope="col" className={`${css.cell} ${css.head}`}>{t('list.head.uses')}</th>
            <th scope="col" className={`${css.cell} ${css.head}`}>{t('list.head.confidence')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.citekey}>
              <td className={`${css.cell} ${css.citekey}`}>{`[${row.citekey}]`}</td>
              <td className={`${css.cell} ${css.title}`}>
                {row.title}
                {row.quarantined && <span className={css.quarantine}>{` ${t('row.quarantined')}`}</span>}
              </td>
              <td className={`${css.cell} ${css.number}`}>{row.year}</td>
              <td className={css.cell}>{metaGroupLabel(row.group, t)}</td>
              <td className={`${css.cell} ${css.number}`}>{row.uses}</td>
              <td className={`${css.cell} ${css.number}`}>
                {row.confidence !== undefined && (
                  <span className={css[confidenceTone(row.confidence)]}>
                    {t('row.confidence', { value: row.confidence })}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
