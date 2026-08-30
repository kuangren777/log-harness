/**
 * The 「加入知识库」 action this package contributes to ②'s result cards.
 *
 * Whether the record is already in the library is not this button's guess: it
 * is the shared store's id set, which the same `apply` seeds from the host and
 * which every add, edit, and removal writes through. A record the host already
 * holds therefore reads 「已在知识库」 the first time the card draws, and the
 * button never offers a gesture whose only outcome would be a merge.
 *
 * Composing this package out of cordis.yml leaves ②'s cards exactly as they
 * were: the slot stays declared and simply has no entry.
 */
import { useState } from 'react'
// Type-only: pulls the `search.result.actions` seat declaration from ②.
import type {} from '@deepseek-ai/dsh-client-ui-sci-search/client'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SciLibraryAddInjected } from './contract.ts'
import type { LibraryStore } from './stores.ts'
import css from './AddToLibrary.module.css'

/** What the button is doing, and what the last attempt produced. */
type AddState = { phase: 'idle' } | { phase: 'busy' } | { phase: 'error'; code: string }

/** Full props of the action, composed from its four shares. */
export type AddToLibraryProps =
  PropsRuntime<'search.result.actions'>
  & PropsStore<LibraryStore>
  & InjectFace<SciLibraryAddInjected>
  & PropsLocale<'sci-library'>

/**
 * Render the action for one search result.
 * @param props - the action's composed slot props.
 * @returns the button, or the stored state it reached.
 */
export function AddToLibrary({ record, useStore, actions, add, t }: AddToLibraryProps) {
  const [state, setState] = useState<AddState>({ phase: 'idle' })
  const stored = useStore(s => s.stored.includes(record.id))

  if (stored) return <span className={css.stored}>{t('action.added')}</span>

  return (
    <>
      <button
        type="button"
        className={css.action}
        disabled={state.phase === 'busy'}
        onClick={() => {
          setState({ phase: 'busy' })
          void add(record).then((outcome) => {
            if (outcome.ok) {
              setState({ phase: 'idle' })
              // The store, not local state: the same record may be on screen
              // in the library view, and both must agree it is held.
              actions.patched(outcome.value)
            } else {
              setState({ phase: 'error', code: outcome.code })
            }
          })
        }}
      >
        {state.phase === 'busy' ? t('action.adding') : t('action.add')}
      </button>
      {state.phase === 'error' && (
        <span className={css.failure} role="alert">{t('action.addFailed', { code: state.code })}</span>
      )}
    </>
  )
}
