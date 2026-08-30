/**
 * The tag editor of one entry.
 *
 * It never holds a tag set of its own: the entry the host last returned is the
 * displayed set, and adding or removing hands the whole next set upward, so a
 * refused write leaves the chips exactly as the library still has them. Only
 * the half-typed tag is local — nothing else here is the editor's to know.
 */
import { useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { SciLibraryKey } from './locales.ts'
import css from './TagEditor.module.css'

/** Owner-controlled tag-editor props. */
export interface TagEditorProps {
  /** The entry's tags as the host last reported them. */
  tags: readonly string[]
  /** Whether a write is already in flight; both controls refuse until it settles. */
  busy: boolean
  /** Write the next tag set. */
  onChange: (tags: readonly string[]) => void
  /** Localized editor copy. */
  t: Translate<SciLibraryKey>
}

/**
 * Render the tag chips and the field that adds one.
 * @param props - owner-controlled tag-editor props.
 * @returns the editor.
 */
export function TagEditor({ tags, busy, onChange, t }: TagEditorProps) {
  const [draft, setDraft] = useState('')
  const trimmed = draft.trim()
  // A tag the entry already carries is not an addition, and the set is what
  // the host stores — so the button refuses rather than sending a no-op write.
  const addable = trimmed !== '' && !tags.includes(trimmed) && !busy

  const add = (): void => {
    if (!addable) return
    setDraft('')
    onChange([...tags, trimmed])
  }

  return (
    <div className={css.root}>
      {tags.map(tag => (
        <span key={tag} className={css.tag}>
          {tag}
          <button
            type="button"
            className={css.remove}
            disabled={busy}
            aria-label={t('detail.tagRemove', { tag })}
            onClick={() => { onChange(tags.filter(kept => kept !== tag)) }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className={css.input}
        type="text"
        value={draft}
        disabled={busy}
        aria-label={t('detail.tagAdd')}
        placeholder={t('detail.tagPlaceholder')}
        onChange={(event) => { setDraft(event.target.value) }}
        onKeyDown={(event) => { if (event.key === 'Enter') add() }}
      />
      <button type="button" className={css.add} disabled={!addable} onClick={add}>
        {t('detail.tagAdd')}
      </button>
    </div>
  )
}
