/**
 * The sign-in surface: a full-page card over the shell, showing whichever of
 * the five steps the controller resolved — credentials, the mailed code, the
 * forgot-password form, the reset landing, or the confirmation landing.
 *
 * The card is the only part of the overlay layer that takes pointer events, so
 * a hidden surface leaves the app entirely alone. Nothing here decides who may
 * do what: the Host already refused the request that made this visible.
 */

import { useState, type FormEvent, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthFace, AuthNotice, AuthState } from './auth-controller.ts'
import type { AuthTranslate } from './locales.ts'
import css from './AuthGateView.module.css'

/** Injected dependencies of {@link AuthGateView} (slot `inject`). */
export type AuthGateInjected = AuthFace

/** Full component props. */
export type AuthGateViewProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'auth'>
  & InjectFace<AuthGateInjected>

/** The notices that report a refusal rather than a completed step. */
const FAILURE_NOTICES: ReadonlySet<AuthNotice> = new Set<AuthNotice>([
  'signInFailed', 'codeFailed', 'rateLimited', 'resetFailed', 'verifyFailed',
])

/** The message under the active form, or nothing when the step is clean. */
function Notice({ notice, t }: { notice: AuthNotice; t: AuthTranslate }): ReactNode {
  if (notice === 'none') return null
  return (
    <p
      className={FAILURE_NOTICES.has(notice) ? css['failure'] : css['notice']}
      role={FAILURE_NOTICES.has(notice) ? 'alert' : 'status'}
    >
      {t(notice)}
    </p>
  )
}

/** One labelled field of the card's forms. */
function Field(props: {
  id: string
  label: string
  type: 'email' | 'password' | 'text'
  value: string
  autoComplete: string
  disabled: boolean
  onChange: (next: string) => void
}): ReactNode {
  return (
    <label className={css['field']} htmlFor={props.id}>
      <span className={css['label']}>{props.label}</span>
      <Input
        id={props.id}
        type={props.type}
        value={props.value}
        autoComplete={props.autoComplete}
        disabled={props.disabled}
        onChange={(event) => { props.onChange(event.target.value) }}
      />
    </label>
  )
}

/** Step one: the address and the password. */
function SignInForm({ state, actions, t }: StepProps): ReactNode {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  return (
    <form
      className={css['form']}
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        actions.signIn(email, password)
      }}
    >
      <h1 className={css['title']}>{t('title')}</h1>
      <p className={css['intro']}>{t('intro')}</p>
      <Field
        id="dsh-auth-email" label={t('email')} type="email" value={email}
        autoComplete="username" disabled={state.pending} onChange={setEmail}
      />
      <Field
        id="dsh-auth-password" label={t('password')} type="password" value={password}
        autoComplete="current-password" disabled={state.pending} onChange={setPassword}
      />
      <Notice notice={state.notice} t={t} />
      <Button type="submit" disabled={state.pending}>
        {state.pending ? t('signingIn') : t('signIn')}
      </Button>
      <button
        type="button"
        className={css['link']}
        disabled={state.pending}
        onClick={() => { actions.beginForgot() }}
      >
        {t('forgotLink')}
      </button>
    </form>
  )
}

/** Step two: the six-digit code the Host mailed. */
function CodeForm({ state, actions, t }: StepProps): ReactNode {
  const [code, setCode] = useState('')
  return (
    <form
      className={css['form']}
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        actions.submitCode(code)
      }}
    >
      <h1 className={css['title']}>{t('codeTitle')}</h1>
      <p className={css['intro']}>{t('codeIntro')}</p>
      <Field
        id="dsh-auth-code" label={t('code')} type="text" value={code}
        autoComplete="one-time-code" disabled={state.pending} onChange={setCode}
      />
      <Notice notice={state.notice} t={t} />
      <Button type="submit" disabled={state.pending}>
        {state.pending ? t('verifying') : t('verify')}
      </Button>
      <button
        type="button"
        className={css['link']}
        disabled={state.pending}
        onClick={() => { actions.backToSignIn() }}
      >
        {t('back')}
      </button>
    </form>
  )
}

/** Ask for a reset link; the acknowledgement never says whether the address has an account. */
function ForgotForm({ state, actions, t }: StepProps): ReactNode {
  const [email, setEmail] = useState('')
  return (
    <form
      className={css['form']}
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        actions.requestReset(email)
      }}
    >
      <h1 className={css['title']}>{t('forgotTitle')}</h1>
      <p className={css['intro']}>{t('forgotIntro')}</p>
      <Field
        id="dsh-auth-forgot-email" label={t('email')} type="email" value={email}
        autoComplete="username" disabled={state.pending} onChange={setEmail}
      />
      <Notice notice={state.notice} t={t} />
      <Button type="submit" disabled={state.pending}>
        {state.pending ? t('forgotSending') : t('forgotSubmit')}
      </Button>
      <button
        type="button"
        className={css['link']}
        disabled={state.pending}
        onClick={() => { actions.backToSignIn() }}
      >
        {t('back')}
      </button>
    </form>
  )
}

/** The mailed reset link's landing: one new password, redeemed against the link's token. */
function ResetForm({ state, actions, t }: StepProps): ReactNode {
  const [password, setPassword] = useState('')
  return (
    <form
      className={css['form']}
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        actions.resetPassword(password)
      }}
    >
      <h1 className={css['title']}>{t('resetTitle')}</h1>
      <p className={css['intro']}>{t('resetIntro')}</p>
      <Field
        id="dsh-auth-new-password" label={t('newPassword')} type="password" value={password}
        autoComplete="new-password" disabled={state.pending} onChange={setPassword}
      />
      <Notice notice={state.notice} t={t} />
      <Button type="submit" disabled={state.pending}>
        {state.pending ? t('resetSaving') : t('resetSubmit')}
      </Button>
    </form>
  )
}

/** The mailed confirmation link's landing: it reports only whether the token redeemed. */
function VerifyPanel({ state, actions, t }: StepProps): ReactNode {
  return (
    <div className={css['form']}>
      <h1 className={css['title']}>{t('verifyTitle')}</h1>
      {state.pending
        ? <p className={css['intro']}>{t('verifyPending')}</p>
        : <Notice notice={state.notice} t={t} />}
      <Button disabled={state.pending} onClick={() => { actions.backToSignIn() }}>
        {t('continueToSignIn')}
      </Button>
    </div>
  )
}

/** The controller's actions as a component sees them, without the hook compartment or the copy. */
type AuthActions = Omit<AuthFace, 'hooks' | 't'>

/** What every step receives: the snapshot, the controller's actions, and the copy. */
interface StepProps {
  state: AuthState
  actions: AuthActions
  t: AuthTranslate
}

/** Render the step the controller resolved. */
function Step(props: StepProps): ReactNode {
  switch (props.state.view) {
    case 'sign-in': return <SignInForm {...props} />
    case 'code': return <CodeForm {...props} />
    case 'forgot': return <ForgotForm {...props} />
    case 'reset': return <ResetForm {...props} />
    // The remaining member is 'hidden', which the caller already returned for.
    default: return <VerifyPanel {...props} />
  }
}

/**
 * Render the sign-in surface.
 * @param props - slot-delivered injected dependencies and copy.
 * @returns the sign-in card, or null while no step is active.
 */
export function AuthGateView(props: AuthGateViewProps): ReactNode {
  const { useAuth, t, ...actions } = props
  const state = useAuth(snapshot => snapshot)
  if (state.view === 'hidden') return null
  return (
    <div className={css['backdrop']} role="dialog" aria-modal="true" aria-label={t('title')}>
      <div className={css['card']}>
        <Step state={state} actions={actions} t={t} />
      </div>
    </div>
  )
}
