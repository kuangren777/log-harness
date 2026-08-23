/**
 * The request gate: the Consumer that turns the auth capability into something
 * a browser can use. It mounts the `/auth` sign-in channel, and it provides
 * `ctx.authGate`, which the HTTP transport asks before it admits any request.
 *
 * Nothing here decides what an authenticated caller may DO — that is the
 * gateway's policy table. This package answers only the first question: who is
 * this request, and how does a browser come to have an answer to present.
 * @module @deepseek-ai/dsh-auth-gate
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Principal, UserId } from '@deepseek-ai/dsh-auth'
import type { ConnectionRpcCaller, ConnectionRpcReply } from '@deepseek-ai/dsh-client-connection'
import type { OwnershipLookup, RequestGate, RequestHeaders } from '@deepseek-ai/dsh-host-apiproxy'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { clearedCookie, joinCredential, sessionCookie } from './cookie.ts'
import { authenticatedRequest, AUTH_ENDPOINTS, type GateContext } from './endpoints.ts'
import { groupAddedMessage } from './messages.ts'
import { resolveSettings, type Config, type GateSettings } from './settings.ts'

export { clearedCookie, joinCredential, readCookie, sessionCookie, splitCredential } from './cookie.ts'
export {
  authenticatedRequest, AUTH_ENDPOINTS, SESSION_ISSUED_EVENT, SIGN_IN_HISTORY_LIMIT,
  type AuthenticatedRequest, type EndpointHandler, type GateContext,
} from './endpoints.ts'
export {
  resolveSettings, DEFAULT_CODE_TTL_MS, DEFAULT_COOKIE_NAME, DEFAULT_LINK_TTL_MS,
  type Config, type GateSettings,
} from './settings.ts'
export type * from './types.ts'

/** The channel every endpoint of this gate is served under. */
export const AUTH_CHANNEL = '/auth'

/**
 * Services required before the gate can provide `ctx.authGate`.
 *
 * All three are hard requirements, and none of them has a fallback. A
 * composition that mounts this plugin without a mail provider cannot deliver a
 * second factor, so it could only sign anyone in by weakening the flow; the
 * plugin stays inactive instead, and the transport refuses to serve while an
 * auth provider is mounted without its gate.
 */
export const inject = ['auth', 'connection', 'mail']

/**
 * The mounted request gate.
 *
 * Its `/auth` channel is registered as `trusted-host`, the same fence the
 * gateway's own transport uses: a deployment reached over a declared authority
 * must be able to sign in from it, and the cookie's `SameSite=Strict` is what
 * keeps another site from driving the channel.
 */
export class AuthGateService extends Service implements RequestGate {
  static inject = inject

  static Config: z<Config> = z.object({
    baseUrl: z.string().required(),
    cookieName: z.string(),
    cookieSecure: z.boolean().default(true),
    codeTtlMs: z.number().step(1).min(1),
    linkTtlMs: z.number().step(1).min(1),
  })

  /** Resolved gate parameters; defaulting happened once, at load. */
  readonly settings: GateSettings

  private readonly gate: GateContext

  /**
   * @param ctx - the plugin context, carrying the auth, mail, and connection services.
   * @param config - validated plugin configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'authGate')
    // Programmatic construction may bypass Schemastery normalization; resolve
    // the same defaults in one explicit step either way.
    this.settings = resolveSettings(config)
    this.gate = {
      auth: ctx.auth,
      mail: ctx.mail,
      settings: this.settings,
      warn: message => { ctx.logger.warn(message) },
    }
    ctx.effect(
      () => ctx.connection.rpc.handle(AUTH_CHANNEL, (endpoint, payload, _signal, caller) =>
        this.dispatch(endpoint, payload, caller), { authority: 'trusted-host' }),
      'auth-gate: /auth rpc channel',
    )
  }

  /** Ownership resolution backed by the same provider that authenticates requests. */
  get ownership(): OwnershipLookup {
    return this.ctx.auth
  }

  /**
   * Resolve one request's credentials to its principal.
   * @param headers - the request's headers, in either HTTP representation.
   * @returns the authenticated principal, or `undefined` when the request carries no valid credential.
   */
  async authenticate(headers: RequestHeaders): Promise<Principal | undefined> {
    return (await authenticatedRequest(headers, this.gate))?.principal
  }

  /**
   * The `Set-Cookie` value that installs one freshly issued login session.
   * @param authSessionId - the issued session's id.
   * @param token - the issued bearer token.
   * @param expiresAt - epoch milliseconds at which the token stops authenticating.
   * @returns the header value to send.
   */
  sessionCookie(authSessionId: string, token: string, expiresAt: number): string {
    return sessionCookie(
      this.settings.cookieName,
      joinCredential(authSessionId, token),
      this.settings.cookieSecure,
      Math.round((expiresAt - Date.now()) / 1000),
    )
  }

  /**
   * The `Set-Cookie` value that removes the login session cookie.
   * @returns the header value to send.
   */
  clearedCookie(): string {
    return clearedCookie(this.settings.cookieName, this.settings.cookieSecure)
  }

  /**
   * Tell an account it was added to a group.
   *
   * The gate owns the template but not the trigger: group membership is
   * changed through `ctx.auth` by whatever administration surface a deployment
   * runs, and the seam publishes no event for it, so the surface that makes
   * the change calls this.
   * @param email - the account's address; the notice is refused for an address with no account, so this cannot be used to mail a stranger.
   * @param groupName - the group the account was added to.
   */
  async notifyAddedToGroup(email: string, groupName: string): Promise<void> {
    const user = await this.ctx.auth.getUserByEmail(email)
    if (user === undefined) return
    await this.ctx.mail.send(groupAddedMessage(user.email, groupName))
    await this.audit(user.userId, groupName)
  }

  private audit(userId: UserId, groupName: string): Promise<void> {
    return this.ctx.auth.audit({ event: 'auth.group-notice-sent', actorUserId: userId, detail: groupName })
  }

  private dispatch(
    endpoint: string,
    payload: unknown,
    caller: ConnectionRpcCaller,
  ): Promise<RpcResult<unknown> | ConnectionRpcReply> {
    const handler = AUTH_ENDPOINTS[endpoint]
    if (handler === undefined) {
      return Promise.resolve({
        ok: false,
        error: { code: 'bad-request', message: `unknown auth endpoint "${endpoint}"`, details: { issues: [] } },
      })
    }
    return handler(payload, caller, this.gate)
  }
}

export default AuthGateService
