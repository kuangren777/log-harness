/**
 * The rail's footer controls: the palette toggle and the account avatar.
 *
 * Neither holds theme or identity state. The toggle subscribes to the theme
 * runtime through an injected reader/subscriber pair (so the component never
 * imports the service), and the avatar draws from the same shell store the
 * account popover writes — one store handle, one instance, one account.
 */
import { useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { avatarGlyph, type ShellStore } from './stores.ts'
import { Moon, MorphStrokeIcon, Sun } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './RailFooter.module.css'

/** Sun glyph edge length, in CSS pixels. */
const SUN_SIZE = 17
/** Moon glyph edge length, in CSS pixels (visually matched to the sun). */
const MOON_SIZE = 16

/** The theme facts the toggle needs, as `apply` hands them over. */
export interface ThemeToggleInjected {
  /** The active palette of the live theme snapshot. */
  getScheme: () => 'light' | 'dark'
  /** Switch the preference to a concrete palette. */
  setTheme: (id: 'light' | 'dark') => void
  /** Subscribe to theme changes; returns the unsubscribe. */
  subscribe: (onChange: () => void) => () => void
}

/** Full props of the palette toggle. */
export type ThemeToggleProps =
  PropsRuntime<'rail.footer'> & ThemeToggleInjected & PropsLocale<'sci-shell'>

/**
 * Render the palette toggle.
 * @param props - the toggle's composed slot props.
 * @returns the footer button.
 */
export function ThemeToggle({ getScheme, setTheme, subscribe, t }: ThemeToggleProps) {
  const scheme = useSyncExternalStore(subscribe, getScheme, getScheme)
  const next = scheme === 'dark' ? 'light' : 'dark'
  const label = next === 'dark' ? t('theme.toDark') : t('theme.toLight')
  return (
    <button
      type="button"
      className={css.button}
      aria-label={label}
      title={label}
      onClick={() => { setTheme(next) }}
    >
      <MorphStrokeIcon icon={scheme === 'dark' ? Sun : Moon} size={scheme === 'dark' ? SUN_SIZE : MOON_SIZE} />
    </button>
  )
}

/** Full props of the account avatar button. */
export type ProfileButtonProps =
  PropsRuntime<'rail.footer'> & PropsStore<ShellStore> & PropsLocale<'sci-shell'>

/**
 * Render the account avatar; clicking it toggles the popover in the overlay
 * layer, which is the other reader of this store.
 * @param props - the button's composed slot props.
 * @returns the footer avatar.
 */
export function ProfileButton({ useStore, actions, t }: ProfileButtonProps) {
  const email = useStore(s => s.me?.email ?? '')
  // The rail is an icon column, so the full identity lives in the hover title
  // (and, always, inside the popover itself).
  const label = email === '' ? t('profile.open') : email
  return (
    <button
      type="button"
      className={css.avatar}
      aria-label={label}
      title={label}
      onClick={() => { actions.toggleProfile() }}
    >
      {avatarGlyph(email)}
    </button>
  )
}
