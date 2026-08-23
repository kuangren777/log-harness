/**
 * The signed-in indicator at the sidebar foot: who this browser is, and the
 * two ways out. It renders only while the Host named an account, so a
 * deployment without authentication shows nothing at all.
 */

import { useState, type ReactNode } from 'react'
import { IconUserOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthFace } from './auth-controller.ts'
import css from './AccountIndicator.module.css'

/** Injected dependencies of {@link AccountIndicator} (slot `inject`). */
export type AccountIndicatorInjected = AuthFace

/** Full component props. */
export type AccountIndicatorProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'auth'>
  & InjectFace<AccountIndicatorInjected>

/**
 * Render the account row.
 * @param props - the sidebar's column state plus the injected face and copy.
 * @returns the row, or null while nobody is signed in.
 */
export function AccountIndicator(props: AccountIndicatorProps): ReactNode {
  const { useAuth, t, wide, signOut, signOutEverywhere } = props
  const state = useAuth(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  if (state.account === undefined) return null
  const label = t('accountOf', { email: state.account })
  return (
    <div className={css['row']}>
      <Tooltip label={label} side="top">
        <button
          type="button"
          className={css['trigger']}
          aria-expanded={open}
          aria-label={label}
          disabled={state.pending}
          onClick={() => { setOpen(!open) }}
        >
          <IconUserOutline16 size={wide ? 14 : 18} />
          {wide && <span className={css['email']}>{state.account}</span>}
        </button>
      </Tooltip>
      {open && (
        <div className={css['menu']} role="menu" aria-label={t('account')}>
          <button
            type="button"
            role="menuitem"
            className={css['item']}
            disabled={state.pending}
            onClick={() => { signOut() }}
          >
            {state.pending ? t('signingOut') : t('signOut')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={css['item']}
            disabled={state.pending}
            onClick={() => { signOutEverywhere() }}
          >
            {state.pending ? t('signingOut') : t('signOutEverywhere')}
          </button>
        </div>
      )}
    </div>
  )
}
