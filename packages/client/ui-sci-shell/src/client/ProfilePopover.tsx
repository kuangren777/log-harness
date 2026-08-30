/**
 * The account popover, an entry of the frame-wide overlay layer.
 *
 * The layer is click-through; this entry opts back into pointer events only
 * while it shows, so a closed popover never intercepts a click meant for the
 * app underneath. The gate read happens once per mount rather than per open,
 * because the rail's avatar draws the same account from the same store and
 * must not wait for the user to open anything.
 *
 * Every row is a fact the gate answered. A gate that could not be read shows
 * one line saying so and no numbers at all.
 */
import { useEffect } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { GateBalance, GateMe } from './gate-me.ts'
import { avatarGlyph, selectedVmOf, type ShellStore } from './stores.ts'
import css from './ProfilePopover.module.css'

/** Where signing out lands the browser. */
const LOGIN_PATH = '/gate/login'

/** The gate's credit page: balance detail and top-up. */
const CREDIT_PATH = '/gate/credit'

/** The gate landing: account facts and VM selection. */
const GATE_PATH = '/gate/'

/** The gate's admin console; the gate itself refuses non-admins. */
const ADMIN_PATH = '/admin/'

/** The gate calls the popover drives, as `apply` hands them over. */
export interface ProfilePopoverInjected {
  /** Read the signed-in account. */
  fetchMe: () => Promise<GateMe | null>
  /** Read the tenant balance. */
  fetchBalance: () => Promise<GateBalance | null>
  /** Clear the gate session; true once it is gone. */
  logout: () => Promise<boolean>
}

/** Full props of the account popover. */
export type ProfilePopoverProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ShellStore>
  & ProfilePopoverInjected
  & PropsLocale<'sci-shell'>

/**
 * Render the account popover.
 * @param props - the popover's composed slot props.
 * @returns the scrim and card while open, nothing otherwise.
 */
export function ProfilePopover({
  useStore, actions, fetchMe, fetchBalance, logout, t,
}: ProfilePopoverProps) {
  const open = useStore(s => s.open)
  const loaded = useStore(s => s.loaded)
  const me = useStore(s => s.me)
  const balance = useStore(s => s.balance)
  const { closeProfile, settleIdentity } = actions

  // One read per mount: both gate answers land in the shared store together,
  // so the avatar and this card never disagree about who is signed in.
  useEffect(() => {
    let live = true
    void Promise.all([fetchMe(), fetchBalance()]).then(([nextMe, nextBalance]) => {
      if (!live) return
      settleIdentity(nextMe, nextBalance)
    })
    return () => { live = false }
  }, [fetchMe, fetchBalance, settleIdentity])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeProfile()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [open, closeProfile])

  if (!open) return null

  const vm = selectedVmOf(me)
  const onLogout = () => {
    // Navigation only on an accepted teardown: a refused sign-out must leave
    // the browser on a page whose cookie still works.
    void logout().then((done) => {
      if (done) location.assign(LOGIN_PATH)
    })
  }

  return (
    <div className={css.root}>
      <button type="button" className={css.scrim} aria-label={t('profile.close')} onClick={() => { closeProfile() }} />
      <div className={css.card} role="dialog" aria-label={t('profile.open')}>
        {!loaded && <p className={css.notice}>{t('profile.loading')}</p>}
        {loaded && me === null && <p className={css.notice}>{t('profile.offline')}</p>}
        {loaded && me !== null && (
          <>
            <div className={css.identity}>
              <div className={css.avatar} aria-hidden="true">{avatarGlyph(me.email)}</div>
              <div className={css.identityText}>
                <div className={css.email}>{me.email}</div>
                <div className={css.meta}>
                  {me.tenant === null
                    ? t('profile.role', { role: me.role })
                    : t('profile.roleTenant', { role: me.role, tenant: me.tenant })}
                </div>
              </div>
            </div>
            {vm !== undefined && (
              <div className={css.row}>{t('profile.vm', { slug: vm.slug, image: vm.image_tag })}</div>
            )}
            {/* The balance row always renders: an unreadable balance is a fact
                worth a sentence, and the credit page is one click either way. */}
            <div className={css.row}>
              {balance !== null
                ? <span>{t('profile.balance', { amount: balance.totalUsd })}</span>
                : <span>{t('profile.balanceUnknown')}</span>}
              {balance !== null && balance.exhausted && <span className={css.exhausted}>{t('profile.exhausted')}</span>}
            </div>
            <div className={css.links}>
              <a className={css.link} href={CREDIT_PATH}>{t('profile.links.credit')}</a>
              <a className={css.link} href={GATE_PATH}>{t('profile.links.gate')}</a>
              {me.role === 'admin' && <a className={css.link} href={ADMIN_PATH}>{t('profile.links.admin')}</a>}
            </div>
            <button type="button" className={css.logout} onClick={onLogout}>{t('profile.logout')}</button>
          </>
        )}
      </div>
    </div>
  )
}
