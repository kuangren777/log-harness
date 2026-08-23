/**
 * Request authorization for the API gateway: who a carrier request belongs to,
 * how a method's policy is checked against that principal, and how ownership
 * of an addressed session or workspace is resolved.
 *
 * The gateway itself mounts no auth provider. Every entry point that does not
 * authenticate resolves to `LOCAL_PRINCIPAL`, which {@link permitsPolicy}
 * passes unconditionally, so a deployment without authentication behaves
 * exactly as it did before this module existed. The policy TABLE lives beside
 * the dispatch table in `fetch/handler.ts`, because a method without a policy
 * row must fail to compile in the same place a method without a route row does.
 * @module @deepseek-ai/dsh-host-apiproxy/authorization
 */

import type { IncomingHttpHeaders } from 'node:http'
import type { Principal, UserId } from '@deepseek-ai/dsh-auth'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { RpcError } from './api/rpc.ts'

/**
 * How one RPC method decides whether a principal may reach it.
 *
 * `user` — any authenticated caller; a method whose answer spans accounts
 * narrows the answer itself rather than refusing the call.
 * `admin` — membership in the builtin administrator group. Reserved for the
 * configuration plane and for host-machine operations.
 * `owner` — the caller owns every session and workspace the payload addresses,
 * or is an administrator.
 */
export type MethodPolicy = 'user' | 'admin' | 'owner'

/**
 * Payload keys an `owner` policy resolves. Naming them here is what makes the
 * policy table's `owner` rows checkable: a method whose payload carries none
 * of these keys cannot be marked `owner`, because there would be nothing to
 * resolve an owner from.
 */
export type OwnableIdKey = 'sessionId' | 'parentSessionId' | 'workspaceId'

/**
 * The subset of the auth seam an authorization decision needs. Declared
 * structurally so `ctx.auth` satisfies it without this package depending on a
 * provider, and so a test can hand over a two-method double.
 */
export interface OwnershipLookup {
  /**
   * Who owns one agent session.
   * @param sessionId - the agent session.
   * @returns the owning account, or `undefined` when no ownership was ever recorded.
   */
  ownerOfSession(sessionId: SessionId): Promise<UserId | undefined>

  /**
   * Who owns one workspace.
   * @param workspaceId - the workspace.
   * @returns the owning account, or `undefined` when no ownership was ever recorded.
   */
  ownerOfWorkspace(workspaceId: WorkspaceId): Promise<UserId | undefined>
}

/**
 * Ownership resolution for a composition that mounts no auth provider.
 *
 * It answers nothing, and nothing asks it: a `local` principal short-circuits
 * every policy and every stream filter before the lookup is reached. Rejecting
 * rather than returning `undefined` keeps a future caller that forgot to pass a
 * real lookup from silently reading "unowned" as an answer.
 */
export const UNAVAILABLE_OWNERSHIP: OwnershipLookup = {
  ownerOfSession: () => Promise.reject(new Error('apiproxy: no auth provider is mounted; session ownership cannot be resolved')),
  ownerOfWorkspace: () => Promise.reject(new Error('apiproxy: no auth provider is mounted; workspace ownership cannot be resolved')),
}

/**
 * Everything the fetch carrier needs to authorize a request. Passing it is how
 * a multi-user deployment turns the gateway's policy table on; omitting it
 * leaves every request `local`.
 */
export interface RequestAuthorization {
  /**
   * Resolve one carrier request to its principal. Synchronous: the transport
   * that admitted the request has already authenticated it — an unauthenticated
   * request never reaches dispatch.
   * @param request - the carrier request being dispatched.
   * @returns the principal this request acts as.
   */
  principalFor(request: Request): Principal

  /** Ownership resolution consulted by `owner` rows and by stream filtering. */
  ownership: OwnershipLookup
}

/**
 * Request headers as either HTTP representation the host serves: the Node
 * `IncomingMessage` view for a raw route or an upgrade, the WHATWG view once a
 * bridge has built a `Request`.
 */
export type RequestHeaders = IncomingHttpHeaders | Headers

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The mounted request gate: how this deployment turns a request's credentials into a principal. */
    authGate: RequestGate
  }
}

/**
 * The authentication a transport asks for before it admits a request.
 *
 * Declared here rather than in the package that implements it because both
 * sides of the question live below that package: the gateway needs the
 * {@link Principal} to dispatch, and the transport that admits the request
 * needs to resolve one before it does. A transport reads it optionally
 * (`ctx.get('authGate')`) — an absent gate is a single-tenant deployment, not
 * a failure.
 */
export interface RequestGate {
  /**
   * Resolve one request's credentials to its principal.
   * @param headers - the request's headers, in either HTTP representation.
   * @returns the authenticated principal, or `undefined` when the request carries no valid credential.
   */
  authenticate(headers: RequestHeaders): Promise<Principal | undefined>

  /**
   * The `Set-Cookie` value that installs one freshly issued login session.
   * @param authSessionId - the issued session's id, carried so a logout can revoke exactly this session.
   * @param token - the issued bearer token.
   * @param expiresAt - epoch milliseconds at which the token stops authenticating.
   * @returns the header value to send.
   */
  sessionCookie(authSessionId: string, token: string, expiresAt: number): string

  /**
   * The `Set-Cookie` value that removes the login session cookie. Sent on
   * logout and on any answer that establishes the caller has no usable
   * session, so a stale cookie stops being resent.
   * @returns the header value to send.
   */
  clearedCookie(): string

  /** Ownership resolution backed by the same provider that authenticated the request. */
  readonly ownership: OwnershipLookup
}

/**
 * The one refusal this layer produces.
 *
 * The text and the empty details are deliberately uniform across every policy:
 * a caller refused for lacking administrator rights and a caller refused for
 * addressing another account's session learn the same thing, so neither the
 * policy table nor the existence of a resource can be probed through the
 * error.
 * @returns the `forbidden` business error.
 */
export function forbiddenError(): RpcError {
  return { code: 'forbidden', message: 'this request is not allowed for the authenticated user', details: {} }
}

/**
 * Whether one principal owns one recorded owner.
 *
 * An `undefined` owner refuses: a session or workspace recorded before
 * authentication was mounted belongs to nobody, and letting the first
 * authenticated caller reach it would hand over every pre-auth conversation on
 * the host. An administrator still reaches it, which is the migration path.
 */
function ownsRecord(principal: Principal, owner: UserId | undefined): boolean {
  return principal.kind === 'user' && owner !== undefined && owner === principal.userId
}

/**
 * Whether the principal owns every session and workspace one payload
 * addresses. A payload addressing none of them is owned vacuously — the caller
 * is asking about nothing that belongs to anyone else.
 *
 * `childSessionId` is deliberately not resolved: a subagent's session is
 * created by its parent Agent, never through `session.create`, so it has no
 * ownership row of its own and the parent's ownership is the authoritative
 * fact. Every subagent method carries `parentSessionId`, which is resolved.
 * @param payload - the parsed request payload.
 * @param principal - the request's principal.
 * @param ownership - the ownership resolution to consult.
 * @returns whether the principal may address the payload's resources.
 */
export async function ownsPayload(
  payload: unknown,
  principal: Principal,
  ownership: OwnershipLookup,
): Promise<boolean> {
  const addressed = payload as Partial<Record<OwnableIdKey | 'beforeSessionId' | 'beforeWorkspaceId', string>>
  const sessions = ([addressed.sessionId, addressed.parentSessionId, addressed.beforeSessionId] as (SessionId | undefined)[])
    .filter((id): id is SessionId => id !== undefined)
  const workspaces = ([addressed.workspaceId, addressed.beforeWorkspaceId] as (WorkspaceId | undefined)[])
    .filter((id): id is WorkspaceId => id !== undefined)
  for (const sessionId of sessions) {
    if (!ownsRecord(principal, await ownership.ownerOfSession(sessionId))) return false
  }
  for (const workspaceId of workspaces) {
    if (!ownsRecord(principal, await ownership.ownerOfWorkspace(workspaceId))) return false
  }
  return true
}

/**
 * Decide one method call against its policy.
 *
 * `local` passes every policy without consulting anything: it is the principal
 * of a single-tenant entry point, which has no accounts to distinguish.
 * @param policy - the method's policy row.
 * @param payload - the parsed request payload, read only by `owner`.
 * @param principal - the request's principal.
 * @param ownership - the ownership resolution to consult.
 * @returns whether the call may proceed.
 */
export async function permitsPolicy(
  policy: MethodPolicy,
  payload: unknown,
  principal: Principal,
  ownership: OwnershipLookup,
): Promise<boolean> {
  if (principal.kind === 'local') return true
  if (principal.admin) return true
  if (policy === 'admin') return false
  if (policy === 'user') return true
  return ownsPayload(payload, principal, ownership)
}
