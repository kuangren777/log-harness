/**
 * The turn's produced files, as one row of chips under the closing message.
 *
 * A chip is a gesture, not a link: clicking hands the path to `ctx.sciFiles`,
 * which pins it in the files mode and brings the details column forward. The
 * chip therefore states what the file is (badge and name; the directory
 * stays in the hover title) and nothing
 * about how to open it — the panel owns that.
 *
 * The row derives nothing: the chain claim already unioned both Turn-scoped
 * readings, so `matched` is the complete path list in display order.
 */
import type { ArtifactChipsProps } from './contract.ts'
import { basename, extensionBadge } from './artifacts-select.ts'
import css from './ArtifactChips.module.css'

/**
 * Render the artifact chip row.
 * @param props - the claimed paths, the session seat, and the locate gesture.
 * @returns the chip row.
 */
export function ArtifactChips({ matched, locate, t }: ArtifactChipsProps) {
  return (
    <div className={css.row}>
      <div className={css.title}>{t('artifacts.title')}</div>
      <div className={css.chips}>
        {matched.map((path) => {
          const name = basename(path)
          return (
            <button
              key={path}
              type="button"
              className={css.chip}
              title={path}
              aria-label={t('artifacts.open', { name })}
              onClick={() => { locate(path) }}
            >
              <span className={css.badge}>{extensionBadge(path)}</span>
              <span className={css.text}>
                <span className={css.name}>{name}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
