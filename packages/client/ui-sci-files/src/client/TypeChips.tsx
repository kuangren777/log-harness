/**
 * The produced-file strip under the panel header: every file this session
 * made, as one chip each, so a report written three turns ago is one click
 * away instead of a walk down the tree.
 *
 * Chips group by extension rather than staying in production order, because
 * the question the strip answers is "where is the spreadsheet", not "what
 * happened when"; within a group the session's own order survives. The strip
 * draws nothing when the session has produced nothing.
 */
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { SciFilesKey } from './locales.ts'
import { extensionOf, fileName } from './paths.ts'
import css from './TypeChips.module.css'

/** Owner-controlled chip-strip props. */
export interface TypeChipsProps {
  /** Every path the session produced, oldest first. */
  paths: readonly string[]
  /** The path the panel is showing, or undefined. */
  current: string | undefined
  /** Pin one produced path. */
  onPick: (path: string) => void
  /** Localized strip copy. */
  t: Translate<SciFilesKey>
}

/**
 * Render the produced-file chips.
 * @param props - owner-controlled chip-strip props.
 * @returns the chip strip, or nothing when the session produced no file.
 */
export function TypeChips({ paths, current, onPick, t }: TypeChipsProps) {
  if (paths.length === 0) return null
  return (
    <div className={css.root} role="group" aria-label={t('chips.label')}>
      {groupByExtension(paths).map(path => (
        <button
          key={path}
          type="button"
          className={css.chip}
          aria-pressed={path === current}
          title={path}
          onClick={() => { onPick(path) }}
        >
          <span className={css.ext}>{extensionLabel(path)}</span>
          <span className={css.name}>{fileName(path)}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * The paths reordered so files of one kind sit together, each group in the
 * order the extension was first produced.
 * @param paths - every produced path, oldest first.
 * @returns the same paths, grouped.
 */
function groupByExtension(paths: readonly string[]): readonly string[] {
  const groups = new Map<string, string[]>()
  for (const path of paths) {
    const extension = extensionOf(path)
    const group = groups.get(extension)
    if (group === undefined) groups.set(extension, [path])
    else group.push(path)
  }
  return [...groups.values()].flat()
}

/** The chip's kind label: the extension without its dot, or the head of the name. */
function extensionLabel(path: string): string {
  const extension = extensionOf(path)
  return extension === '' ? fileName(path).slice(0, 3).toUpperCase() : extension.slice(1).toUpperCase()
}
