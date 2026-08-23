/**
 * Sign-in controller: the whole browser side of the `/auth` channel, as one
 * snapshot the surface renders from.
 *
 * It decides nothing about authorization. The Host has already refused an
 * unauthenticated request by the time this is visible, and every answer here
 * is the Host's own — this controller only carries the two sign-in steps, the
 * two mailed landings, and the sign-out calls, and re-boots the shell once the
 * cookie changed.
 */

import type { AuthRequiredSource, RpcResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { AuthTranslate } from './locales.ts'

/** The channel every endpoint of the request gate is served under; the gate spells the same value. */
export const AUTH_CHANNEL = '/auth'

/** Path the gate's confirmation mail links to. */
export const VERIFY_EMAIL_PATH = '/verify-email'

/** Path the gate's password-reset mail links to. */
export const RESET_PASSWORD_PATH = '/reset-password'

/** Which surface the overlay shows; `hidden` renders nothing at all. */
export type AuthView = 'hidden' | 'sign-in' | 'code' | 'forgot' | 'reset' | 'verify'

/**
 * The single message under the active form. Failures are shapeless on purpose:
 * `signInFailed` covers a wrong password, an unknown address, and a disabled
 * account alike, because the Host answers all three identically.
 */
export type AuthNotice =
  | 'none' | 'signInFailed' | 'codeFailed' | 'rateLimited'
  | 'forgotSent' | 'resetDone' | 'resetFailed' | 'verified' | 'verifyFailed'

/** Everything the sign-in surface and the account indicator render from. */
export interface AuthState {
  /** Whether this deployment authenticates at all — false until the `/auth` channel answers. */
  mounted: boolean
  /** The surface to show. */
  view: AuthView
  /** A request is in flight: submits are disabled and progress is shown. */
  pending: boolean
  /** The message under the form. */
  notice: AuthNotice
  /** The signed-in account's address, or undefined when nobody is signed in. */
  account: string | undefined
  /** Whether the signed-in account is an administrator. */
  admin: boolean
}

/** The landing URL the page opened on, which is where a mailed link arrives. */
export interface AuthLanding {
  /** Path component, matched against the two mailed link paths. */
  pathname: string
  /** Query component, carrying the one-time token. */
  search: string
}

/** Everything the controller reaches outside itself. */
export interface AuthDeps {
  /**
   * Call one `/auth` endpoint. Rejects when the channel is not mounted, which
   * is how a deployment without authentication is recognized.
   */
  call(channel: string, endpoint: string, payload: unknown): Promise<RpcResult<unknown>>
  /** The transport's latch: whether an `/api` call was refused as unauthenticated. */
  authRequired: AuthRequiredSource
  /** The page's landing URL. */
  landing: AuthLanding
  /**
   * Re-boot the shell. Called after the credential cookie changed in either
   * direction: every surface of the app was loaded under the old one, and the
   * event streams were opened under it, so the honest way to continue is the
   * boot the browser already performs.
   */
  reload(): void
}

/** The registration-side face both this package's slot entries inject. */
export interface AuthFace {
  hooks: {
    /** Sign-in snapshot, bound by the renderer as useAuth. */
    auth: SnapshotStore<AuthState>
  }
  /** Submit the address and password (`login.start`). */
  signIn(email: string, password: string): void
  /** Submit the mailed six-digit code (`login.verify`). */
  submitCode(code: string): void
  /** Leave the code step and start over with the credentials. */
  backToSignIn(): void
  /** Open the forgot-password form. */
  beginForgot(): void
  /** Ask for a reset link (`password.forgot`). */
  requestReset(email: string): void
  /** Redeem the mailed reset link with a new password (`password.reset`). */
  resetPassword(password: string): void
  /** End this browser's session (`logout`). */
  signOut(): void
  /** End every session this account has (`logoutEverywhere`). */
  signOutEverywhere(): void
  /** Surface copy. */
  t: AuthTranslate
}

/**
 * The notice for one refused `login.start`.
 *
 * A retry deadline is the only fact a refusal carries, and it says a limit was
 * hit — never how often, and never whether the address has an account. The
 * copy repeats exactly that much.
 * @param retryAfterMs - the deadline the Host reported, when it reported one.
 * @returns the notice to show under the form.
 */
function startNotice(retryAfterMs: number | undefined): AuthNotice {
  return retryAfterMs === undefined ? 'signInFailed' : 'rateLimited'
}

/** The sign-in surface's controller (one per browser page). */
export class AuthController {
  /** The snapshot every surface of this package renders from. */
  readonly store: SnapshotStore<AuthState> = createSnapshotStore<AuthState>({
    mounted: false, view: 'hidden', pending: false, notice: 'none', account: undefined, admin: false,
  })

  /** The challenge `login.start` answered with; `login.verify` addresses it. */
  private pendingId: string | undefined
  /** The address and token a mailed reset link carried. */
  private reset: { email: string; token: string } | undefined
  private readonly stopWatchingAuthRequired: () => void

  /**
   * @param deps - the channel caller, the transport's 401 latch, the landing URL, and the shell reboot.
   */
  constructor(private readonly deps: AuthDeps) {
    this.stopWatchingAuthRequired = deps.authRequired.subscribe(() => { this.onAuthRequired() })
  }

  /**
   * Resolve what this page opened on: a mailed landing, an authenticated
   * session, or the sign-in form. A channel that does not answer is a
   * deployment with no authentication, and the surface stays hidden for the
   * rest of the page's life.
   * @returns settlement after the first answer.
   */
  async start(): Promise<void> {
    const landing = this.landingRequest()
    if (landing !== undefined) {
      await landing
      return
    }
    await this.readAccount()
  }

  /**
   * Submit the credentials.
   * @param email - the submitted address.
   * @param password - the submitted password.
   * @returns settlement after the answer.
   */
  async signIn(email: string, password: string): Promise<void> {
    const value = await this.request<{ status: string; pendingId?: string; retryAfterMs?: number }>(
      'login.start', { email, password },
    )
    if (value === undefined) return
    if (value.status !== '2fa-required') {
      this.settle('sign-in', startNotice(value.retryAfterMs))
      return
    }
    this.pendingId = value.pendingId
    this.settle('code', 'none')
  }

  /**
   * Submit the mailed second factor. Success replaces the page: the cookie the
   * Host just set governs every stream the shell opens.
   * @param code - the submitted six-digit code.
   * @returns settlement after the answer.
   */
  async submitCode(code: string): Promise<void> {
    const value = await this.request<{ status: string }>(
      'login.verify', { pendingId: this.pendingId ?? '', code },
    )
    if (value === undefined) return
    if (value.status !== 'ok') {
      this.settle('code', 'codeFailed')
      return
    }
    this.deps.reload()
  }

  /** Leave the code step; the challenge stays unredeemed and expires on its own. */
  backToSignIn(): void {
    this.pendingId = undefined
    this.settle('sign-in', 'none')
  }

  /** Open the forgot-password form. */
  beginForgot(): void {
    this.settle('forgot', 'none')
  }

  /**
   * Ask for a reset link. The acknowledgement is the same whether or not the
   * address has an account, so the copy says "if".
   * @param email - the submitted address.
   * @returns settlement after the answer.
   */
  async requestReset(email: string): Promise<void> {
    const value = await this.request<{ status: string }>('password.forgot', { email })
    if (value === undefined) return
    this.settle('forgot', 'forgotSent')
  }

  /**
   * Redeem the mailed reset link. The address rides with it because the Host
   * mails the change notice to the account's own stored address.
   * @param password - the new password.
   * @returns settlement after the answer.
   */
  async resetPassword(password: string): Promise<void> {
    const link = this.reset
    /* v8 ignore next -- the reset form only renders for a landing that set this */
    if (link === undefined) return
    const value = await this.request<{ status: string }>(
      'password.reset', { email: link.email, token: link.token, password },
    )
    if (value === undefined) return
    this.settle(value.status === 'ok' ? 'sign-in' : 'reset', value.status === 'ok' ? 'resetDone' : 'resetFailed')
  }

  /**
   * End this browser's session and re-boot.
   * @returns settlement after the answer.
   */
  signOut(): Promise<void> {
    return this.endSession('logout')
  }

  /**
   * End every session this account has and re-boot.
   * @returns settlement after the answer.
   */
  signOutEverywhere(): Promise<void> {
    return this.endSession('logoutEverywhere')
  }

  /**
   * Build the face this package's slot entries inject.
   * @param t - this namespace's bound translate.
   * @returns the snapshot and the surface's actions.
   */
  inject(t: AuthTranslate): AuthFace {
    return {
      hooks: { auth: this.store },
      signIn: (email, password) => { void this.signIn(email, password) },
      submitCode: (code) => { void this.submitCode(code) },
      backToSignIn: () => { this.backToSignIn() },
      beginForgot: () => { this.beginForgot() },
      requestReset: (email) => { void this.requestReset(email) },
      resetPassword: (password) => { void this.resetPassword(password) },
      signOut: () => { void this.signOut() },
      signOutEverywhere: () => { void this.signOutEverywhere() },
      t,
    }
  }

  /** Release the transport subscription. */
  dispose(): void {
    this.stopWatchingAuthRequired()
  }

  /** The landing request this page's URL asks for, or undefined for an ordinary boot. */
  private landingRequest(): Promise<void> | undefined {
    const { pathname, search } = this.deps.landing
    const params = new URLSearchParams(search)
    const token = params.get('token')
    if (token === null) return undefined
    if (pathname === VERIFY_EMAIL_PATH) return this.confirmAddress(token)
    if (pathname !== RESET_PASSWORD_PATH) return undefined
    // The address is part of the link; without it the Host cannot be asked to
    // change a password, so the landing falls back to the ordinary sign-in.
    const email = params.get('email')
    if (email === null) return undefined
    this.reset = { email, token }
    this.settle('reset', 'none')
    return Promise.resolve()
  }

  /** Redeem a confirmation link and report only whether it redeemed. */
  private async confirmAddress(token: string): Promise<void> {
    this.store.update((draft) => { draft.view = 'verify' })
    const value = await this.request<{ status: string }>('email.verify', { token })
    if (value === undefined) return
    this.settle('verify', value.status === 'ok' ? 'verified' : 'verifyFailed')
  }

  /** Read who the cookie authenticates, and show the form when it is nobody. */
  private async readAccount(): Promise<void> {
    const value = await this.request<{ authenticated: boolean; email?: string; admin?: boolean }>('me', {})
    if (value === undefined) return
    if (!value.authenticated) {
      this.settle('sign-in', 'none')
      return
    }
    this.store.update((draft) => {
      draft.pending = false
      draft.view = 'hidden'
      draft.notice = 'none'
      draft.account = value.email
      draft.admin = value.admin === true
    })
  }

  /** Call one endpoint through the channel, or hide the surface when there is no channel. */
  private async request<T>(endpoint: string, payload: unknown): Promise<T | undefined> {
    this.store.update((draft) => { draft.pending = true })
    let result: RpcResult<unknown>
    try {
      result = await this.deps.call(AUTH_CHANNEL, endpoint, payload)
    } catch {
      // The channel is not mounted, which is a deployment that does not
      // authenticate. There is nothing to sign into and nothing to report.
      this.store.update((draft) => {
        draft.mounted = false
        draft.pending = false
        draft.view = 'hidden'
      })
      return undefined
    }
    this.store.update((draft) => {
      draft.mounted = true
      draft.pending = false
    })
    // A rejected business result is a malformed payload — the only refusal
    // these endpoints make — and it is a defect here, not a user mistake.
    /* v8 ignore next -- every payload this controller sends is the endpoint's own */
    if (!result.ok) return undefined
    return result.value as T
  }

  /** End a session through the named endpoint, then re-boot whether or not it answered. */
  private async endSession(endpoint: 'logout' | 'logoutEverywhere'): Promise<void> {
    const value = await this.request<{ status: string }>(endpoint, {})
    if (value === undefined) return
    this.deps.reload()
  }

  /** Move to one view with one notice, with nothing in flight. */
  private settle(view: AuthView, notice: AuthNotice): void {
    this.store.update((draft) => {
      draft.pending = false
      draft.view = view
      draft.notice = notice
    })
  }

  /**
   * The transport refused a request as unauthenticated. The surface asks the
   * Host who this browser is rather than assuming: the refusal may have raced
   * a sign-in that already succeeded in another tab.
   */
  private onAuthRequired(): void {
    if (!this.deps.authRequired.getSnapshot()) return
    if (this.store.getSnapshot().view !== 'hidden') return
    void this.readAccount()
  }
}
