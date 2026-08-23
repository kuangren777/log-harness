/**
 * Server side of the fetch carrier: maps an ApiProxy onto a pure
 * WHATWG Request->Response function. Two-level parse: full form (type/rpcId/method +
 * path==method) -> payload dispatched per method. HTTP status expresses only the carrier
 * (404 unknown path / 415 non-JSON media type / 400 non-JSON body / 500 handler crash);
 * business errors are always 200 + ServerResponse.
 */

import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import type { ApiProxy, MuxFrame, HostFrame } from '../api/index.ts'
import { sessionLogQuerySchema } from '../api/downloads.schema.ts'
import { LOCAL_PRINCIPAL, type Principal } from '@deepseek-ai/dsh-auth'
import type { RequestPayload, ResponseValue, RpcMethodMap } from '../api/rpc-map.ts'
import type {
  AuthorizedRequest, ClientRequest, RpcError, RpcRequest, RpcResponse, ServerRequest, ServerResponse,
} from '../api/rpc.ts'
import { RpcId } from '../api/rpc.ts'
import {
  forbiddenError, permitsPolicy, UNAVAILABLE_OWNERSHIP, type MethodPolicy, type OwnableIdKey,
  type OwnershipLookup, type RequestAuthorization,
} from '../authorization.ts'
import type { Wire } from '../api/rpc.schema.ts'
import { clientRequestSchema, clientResponseSchema } from '../api/rpc.schema.ts'
import {
  sessionCancelRequestSchema,
  sessionAttachmentRequestSchema,
  sessionCreateRequestSchema,
  sessionForkRequestSchema,
  sessionHistoryRequestSchema,
  sessionListRequestSchema,
  sessionModelsRequestSchema,
  sessionPromptRequestSchema,
  sessionRenameRequestSchema,
  sessionSearchRequestSchema,
  sessionSelectModelRequestSchema,
  sessionUpdateQueueRequestSchema,
} from '../api/sessions.schema.ts'
import {
  hostCreateDirectoryRequestSchema, hostDescribeRequestSchema,
  hostListDirectoryRequestSchema, hostOpenPathRequestSchema,
  hostPickDirectoryRequestSchema,
} from '../api/host.schema.ts'
import {
  workspaceArchiveSessionRequestSchema,
  workspaceCreateRequestSchema,
  workspaceDeleteRequestSchema,
  workspaceInsertBeforeRequestSchema,
  workspaceInsertSessionBeforeRequestSchema,
  workspaceListRequestSchema,
  workspaceRenameRequestSchema,
} from '../api/workspace.schema.ts'
import { skillInventoryRequestSchema, skillListRequestSchema } from '../api/skills.schema.ts'
import {
  authAdminGroupsCreateRequestSchema, authAdminGroupsDeleteRequestSchema,
  authAdminGroupsListRequestSchema, authAdminGroupsRenameRequestSchema,
  authAdminMembersSetRequestSchema, authAdminRulesSetRequestSchema,
  authAdminUsersCreateRequestSchema, authAdminUsersDisableRequestSchema,
  authAdminUsersListRequestSchema,
} from '../api/auth-admin.schema.ts'
import {
  agentPresetCopyRequestSchema, agentPresetListRequestSchema, agentPresetOpenDocumentRequestSchema,
  agentPresetReadRequestSchema, agentPresetRemoveRequestSchema, agentPresetSelectRequestSchema,
} from '../api/agent-presets.schema.ts'
import {
  goalCreateRequestSchema,
  goalEditRequestSchema,
  goalPauseRequestSchema,
  goalResumeRequestSchema,
  goalCompleteRequestSchema,
  goalClearRequestSchema,
} from '../api/goals.schema.ts'
import {
  settingsDescribeRequestSchema, settingsMutateRequestSchema, settingsOpenDocumentRequestSchema,
  settingsReplaceRequestSchema, settingsUpdateRequestSchema,
} from '../api/settings.schema.ts'
import {
  credentialsDescribeRequestSchema, credentialsSetRequestSchema, credentialsUnsetRequestSchema,
} from '../api/credentials.schema.ts'
import { llmDiscoverModelsRequestSchema, llmModelsRequestSchema, llmProvidersRequestSchema } from '../api/llm.schema.ts'
import {
  subagentHistoryRequestSchema,
  subagentInterruptRequestSchema,
  subagentListRequestSchema,
  subagentPromptRequestSchema,
} from '../api/subagents.schema.ts'

/**
 * Unary dispatch table, keyed by (and compiler-locked to) RpcMethodMap: a map row without a
 * route row fails to compile, and each row's schema/invoke pair is checked against that row's
 * payload type — a schema pasted onto the wrong row is a type error, not a runtime surprise.
 * Schemas anchor to the Wire<> widening (the repo-wide exactOptionalPropertyTypes accommodation
 * documented on Wire); the dispatch point carries the one Wire→exact cast.
 * Every invoke receives the carrier Request's signal; routes whose contract
 * declares a signal parameter forward it, and the rest ignore it.
 */
type UnaryRoutes = {
  [K in keyof RpcMethodMap]: {
    schema: z.ZodType<Wire<RequestPayload<K>>>
    invoke(api: ApiProxy, request: AuthorizedRequest<RequestPayload<K>>, signal: AbortSignal): Promise<RpcResponse<ResponseValue<K>>>
  }
}

const UNARY_ROUTES: UnaryRoutes = {
  'session.list': { schema: sessionListRequestSchema, invoke: (api, r) => api.sessions.list(r) },
  'session.search': { schema: sessionSearchRequestSchema, invoke: (api, r, signal) => api.sessions.search(r, signal) },
  'session.create': { schema: sessionCreateRequestSchema, invoke: (api, r) => api.sessions.create(r) },
  'session.history': { schema: sessionHistoryRequestSchema, invoke: (api, r) => api.sessions.history(r) },
  'session.models': { schema: sessionModelsRequestSchema, invoke: (api, r) => api.sessions.models(r) },
  'session.selectModel': { schema: sessionSelectModelRequestSchema, invoke: (api, r) => api.sessions.selectModel(r) },
  'session.rename': { schema: sessionRenameRequestSchema, invoke: (api, r) => api.sessions.rename(r) },
  'session.fork': { schema: sessionForkRequestSchema, invoke: (api, r) => api.sessions.fork(r) },
  'session.prompt': { schema: sessionPromptRequestSchema, invoke: (api, r) => api.sessions.prompt(r) },
  'session.attachment': { schema: sessionAttachmentRequestSchema, invoke: (api, r) => api.sessions.attachment(r) },
  'session.updateQueue': { schema: sessionUpdateQueueRequestSchema, invoke: (api, r) => api.sessions.updateQueue(r) },
  'session.cancel': { schema: sessionCancelRequestSchema, invoke: (api, r) => api.sessions.cancel(r) },
  'subagent.list': { schema: subagentListRequestSchema, invoke: (api, r, signal) => api.subagents.list(r, signal) },
  'subagent.history': { schema: subagentHistoryRequestSchema, invoke: (api, r, signal) => api.subagents.history(r, signal) },
  'subagent.prompt': { schema: subagentPromptRequestSchema, invoke: (api, r, signal) => api.subagents.prompt(r, signal) },
  'subagent.interrupt': { schema: subagentInterruptRequestSchema, invoke: (api, r) => api.subagents.interrupt(r) },
  'host.describe': { schema: hostDescribeRequestSchema, invoke: (api, r) => api.host.describe(r) },
  'host.pickDirectory': { schema: hostPickDirectoryRequestSchema, invoke: (api, r, signal) => api.host.pickDirectory(r, signal) },
  'host.listDirectory': { schema: hostListDirectoryRequestSchema, invoke: (api, r, signal) => api.host.listDirectory(r, signal) },
  'host.createDirectory': { schema: hostCreateDirectoryRequestSchema, invoke: (api, r) => api.host.createDirectory(r) },
  'host.openPath': { schema: hostOpenPathRequestSchema, invoke: (api, r, signal) => api.host.openPath(r, signal) },
  'workspace.list': { schema: workspaceListRequestSchema, invoke: (api, r) => api.workspace.list(r) },
  'workspace.create': { schema: workspaceCreateRequestSchema, invoke: (api, r) => api.workspace.create(r) },
  'workspace.rename': { schema: workspaceRenameRequestSchema, invoke: (api, r) => api.workspace.rename(r) },
  'workspace.delete': { schema: workspaceDeleteRequestSchema, invoke: (api, r) => api.workspace.delete(r) },
  'workspace.insertBefore': { schema: workspaceInsertBeforeRequestSchema, invoke: (api, r) => api.workspace.insertBefore(r) },
  'workspace.insertSessionBefore': { schema: workspaceInsertSessionBeforeRequestSchema, invoke: (api, r) => api.workspace.insertSessionBefore(r) },
  'workspace.archiveSession': { schema: workspaceArchiveSessionRequestSchema, invoke: (api, r) => api.workspace.archiveSession(r) },
  'skill.list': { schema: skillListRequestSchema, invoke: (api, r) => api.skills.list(r) },
  'skill.inventory': { schema: skillInventoryRequestSchema, invoke: (api, r) => api.skills.inventory(r) },
  'agentPreset.list': { schema: agentPresetListRequestSchema, invoke: (api, r) => api.agentPresets.list(r) },
  'agentPreset.select': { schema: agentPresetSelectRequestSchema, invoke: (api, r) => api.agentPresets.select(r) },
  'agentPreset.read': { schema: agentPresetReadRequestSchema, invoke: (api, r) => api.agentPresets.read(r) },
  'agentPreset.copy': { schema: agentPresetCopyRequestSchema, invoke: (api, r) => api.agentPresets.copy(r) },
  'agentPreset.openDocument': { schema: agentPresetOpenDocumentRequestSchema, invoke: (api, r, signal) => api.agentPresets.openDocument(r, signal) },
  'agentPreset.remove': { schema: agentPresetRemoveRequestSchema, invoke: (api, r) => api.agentPresets.remove(r) },
  'goal.create': { schema: goalCreateRequestSchema, invoke: (api, r) => api.goals.create(r) },
  'goal.edit': { schema: goalEditRequestSchema, invoke: (api, r) => api.goals.edit(r) },
  'goal.pause': { schema: goalPauseRequestSchema, invoke: (api, r) => api.goals.pause(r) },
  'goal.resume': { schema: goalResumeRequestSchema, invoke: (api, r) => api.goals.resume(r) },
  'goal.complete': { schema: goalCompleteRequestSchema, invoke: (api, r) => api.goals.complete(r) },
  'goal.clear': { schema: goalClearRequestSchema, invoke: (api, r) => api.goals.clear(r) },
  'settings.describe': { schema: settingsDescribeRequestSchema, invoke: (api, r) => api.settings.describe(r) },
  'settings.openDocument': { schema: settingsOpenDocumentRequestSchema, invoke: (api, r, signal) => api.settings.openDocument(r, signal) },
  'settings.update': { schema: settingsUpdateRequestSchema, invoke: (api, r) => api.settings.update(r) },
  'settings.replace': { schema: settingsReplaceRequestSchema, invoke: (api, r) => api.settings.replace(r) },
  'settings.mutate': { schema: settingsMutateRequestSchema, invoke: (api, r) => api.settings.mutate(r) },
  'credentials.describe': { schema: credentialsDescribeRequestSchema, invoke: (api, r) => api.credentials.describe(r) },
  'credentials.set': { schema: credentialsSetRequestSchema, invoke: (api, r) => api.credentials.set(r) },
  'credentials.unset': { schema: credentialsUnsetRequestSchema, invoke: (api, r) => api.credentials.unset(r) },
  'llm.providers': { schema: llmProvidersRequestSchema, invoke: (api, r) => api.llm.providers(r) },
  'llm.models': { schema: llmModelsRequestSchema, invoke: (api, r) => api.llm.models(r) },
  'llm.discoverModels': { schema: llmDiscoverModelsRequestSchema, invoke: (api, r, signal) => api.llm.discoverModels(r, signal) },
  'auth.admin.users.list': { schema: authAdminUsersListRequestSchema, invoke: (api, r) => api.authAdmin.listUsers(r) },
  'auth.admin.users.create': { schema: authAdminUsersCreateRequestSchema, invoke: (api, r) => api.authAdmin.createUser(r) },
  'auth.admin.users.disable': { schema: authAdminUsersDisableRequestSchema, invoke: (api, r) => api.authAdmin.disableUser(r) },
  'auth.admin.groups.list': { schema: authAdminGroupsListRequestSchema, invoke: (api, r) => api.authAdmin.listGroups(r) },
  'auth.admin.groups.create': { schema: authAdminGroupsCreateRequestSchema, invoke: (api, r) => api.authAdmin.createGroup(r) },
  'auth.admin.groups.delete': { schema: authAdminGroupsDeleteRequestSchema, invoke: (api, r) => api.authAdmin.deleteGroup(r) },
  'auth.admin.groups.rename': { schema: authAdminGroupsRenameRequestSchema, invoke: (api, r) => api.authAdmin.renameGroup(r) },
  'auth.admin.members.set': { schema: authAdminMembersSetRequestSchema, invoke: (api, r) => api.authAdmin.setMembers(r) },
  'auth.admin.rules.set': { schema: authAdminRulesSetRequestSchema, invoke: (api, r) => api.authAdmin.setRules(r) },
}

/**
 * `owner` is offered only to a method whose payload addresses something
 * ownable. Without a `sessionId`, `parentSessionId`, or `workspaceId` there is
 * nothing for an owner check to resolve, so the row would silently pass every
 * authenticated caller.
 */
type OwnerCapable<K extends keyof RpcMethodMap> =
  [Extract<keyof RequestPayload<K>, OwnableIdKey>] extends [never] ? never : 'owner'

/** The policies one method may declare. */
type PolicyRow<K extends keyof RpcMethodMap> = 'user' | 'admin' | OwnerCapable<K>

/**
 * Authorization table, keyed by (and compiler-locked to) RpcMethodMap beside
 * UNARY_ROUTES: a new method fails to compile until someone decides who may
 * call it. Policies are enforced only when a deployment hands
 * {@link toFetchHandler} a {@link RequestAuthorization}; without one every
 * request is `local` and passes.
 *
 * The non-obvious rows:
 *
 * - `session.create` is `user`, not `owner`, because the client pre-allocates
 *   the session id it asks for: an id with no owner is the normal case, and an
 *   owner check would refuse every fresh session. The implementation makes the
 *   decision instead — it refuses a workspace or an already-owned id the
 *   caller does not own, and records the new session's owner.
 * - `session.list`, `session.search`, and `workspace.list` are `user` because
 *   they answer across accounts; the implementation narrows the answer to what
 *   the caller owns rather than refusing the call.
 * - The subagent methods are `owner` on `parentSessionId`. A subagent catalog
 *   and transcript are projections of one parent conversation, so owning that
 *   parent is the whole question; the children have no ownership rows.
 * - `host.listDirectory` and `host.createDirectory` are `user`, while
 *   `host.pickDirectory` and `host.openPath` are `admin`. Reading and creating
 *   a directory is what a workspace picker does, and any caller that may open
 *   a session already runs commands as this process through the default
 *   toolset; the other two drive the host machine's desktop instead of
 *   answering the caller.
 * - The settings, credentials, agent-preset authoring, `skill.inventory`, and
 *   `llm.discoverModels` rows are `admin`: they are the configuration plane
 *   the browser-trust fence already pins to loopback, and reading them is as
 *   privileged as writing them.
 * - `llm.providers` and `llm.models` stay `user`: the catalog carries provider
 *   ids, display names, and model lists, and every session composer needs it.
 * - Every `auth.admin.*` row is `admin`, with no narrower option. They are the
 *   plane that decides what every other row admits, so a caller able to reach
 *   one of them could grant itself the rest; `owner` is not even offered,
 *   since their payloads address accounts and groups rather than sessions.
 */
const METHOD_POLICY: { [K in keyof RpcMethodMap]: PolicyRow<K> } = {
  'session.list': 'user',
  'session.search': 'user',
  'session.create': 'user',
  'session.history': 'owner',
  'session.models': 'owner',
  'session.selectModel': 'owner',
  'session.rename': 'owner',
  'session.fork': 'owner',
  'session.prompt': 'owner',
  'session.attachment': 'owner',
  'session.updateQueue': 'owner',
  'session.cancel': 'owner',
  'subagent.list': 'owner',
  'subagent.history': 'owner',
  'subagent.prompt': 'owner',
  'subagent.interrupt': 'owner',
  'host.describe': 'user',
  'host.pickDirectory': 'admin',
  'host.listDirectory': 'user',
  'host.createDirectory': 'user',
  'host.openPath': 'admin',
  'workspace.list': 'user',
  'workspace.create': 'user',
  'workspace.rename': 'owner',
  'workspace.delete': 'owner',
  'workspace.insertBefore': 'owner',
  'workspace.insertSessionBefore': 'owner',
  'workspace.archiveSession': 'owner',
  'skill.list': 'owner',
  'skill.inventory': 'admin',
  'agentPreset.list': 'user',
  'agentPreset.select': 'owner',
  'agentPreset.read': 'admin',
  'agentPreset.copy': 'admin',
  'agentPreset.openDocument': 'admin',
  'agentPreset.remove': 'admin',
  'goal.create': 'owner',
  'goal.edit': 'owner',
  'goal.pause': 'owner',
  'goal.resume': 'owner',
  'goal.complete': 'owner',
  'goal.clear': 'owner',
  'settings.describe': 'admin',
  'settings.openDocument': 'admin',
  'settings.update': 'admin',
  'settings.replace': 'admin',
  'settings.mutate': 'admin',
  'credentials.describe': 'admin',
  'credentials.set': 'admin',
  'credentials.unset': 'admin',
  'llm.providers': 'user',
  'llm.models': 'user',
  'llm.discoverModels': 'admin',
  'auth.admin.users.list': 'admin',
  'auth.admin.users.create': 'admin',
  'auth.admin.users.disable': 'admin',
  'auth.admin.groups.list': 'admin',
  'auth.admin.groups.create': 'admin',
  'auth.admin.groups.delete': 'admin',
  'auth.admin.groups.rename': 'admin',
  'auth.admin.members.set': 'admin',
  'auth.admin.rules.set': 'admin',
}

/**
 * One method's policy, as the table declares it.
 * @param method - the RPC method name.
 * @returns the declared policy.
 */
export function policyOf(method: keyof RpcMethodMap): MethodPolicy {
  return METHOD_POLICY[method]
}

/** Route lookup that narrows an arbitrary path segment to a map key (single cast point for the string→key refinement). */
function methodFor(path: string): keyof RpcMethodMap | undefined {
  return Object.hasOwn(UNARY_ROUTES, path) ? path as keyof RpcMethodMap : undefined
}

/**
 * Every unary method this carrier serves, derived from the dispatch table so
 * that a caller enumerating methods — an authorization suite asserting what
 * each policy admits — cannot fall behind a new row.
 */
export const UNARY_METHODS: readonly (keyof RpcMethodMap)[] = Object.keys(UNARY_ROUTES) as (keyof RpcMethodMap)[]

/**
 * The single-tenant authorization: every request is `local`, and no ownership
 * is ever consulted because `local` passes every policy before the lookup.
 */
const LOCAL_AUTHORIZATION: RequestAuthorization = {
  principalFor: () => LOCAL_PRINCIPAL,
  ownership: UNAVAILABLE_OWNERSHIP,
}

/**
 * Sentinel rpcId for error responses to envelopes whose own rpcId is unreadable: the response
 * must still be a valid ServerResponse (a self-violating shape would turn the server's explicit
 * bad-request report into a client-side parse failure). Fixed value, documented here as wire contract.
 */
const INVALID_REQUEST_RPC_ID = RpcId('invalid-request')

/** Wrap a business error as a ServerResponse full form (rpcId backfilled; an unreadable rpcId uses the invalid-request sentinel). */
function errorResponse(rpcId: RpcId, error: RpcError): Response {
  const body: ServerResponse = { type: 'server-response', rpcId, result: { ok: false, error } }
  return Response.json(body)
}

/** Complete the impl's narrow form into a ServerResponse full form. */
function fullResponse(narrow: RpcResponse<unknown>): Response {
  const body: ServerResponse = { type: 'server-response', rpcId: narrow.rpcId, result: narrow.result }
  return Response.json(body)
}

/**
 * Parse the payload and invoke one unary route. Generic over the map key so
 * the row's schema/invoke pairing typechecks; the only cast collapses the
 * Wire<> widening back to the exact payload (undefined-valued properties and
 * absent ones are indistinguishable after JSON transport).
 */
// K appears once in the signature but ties the UNARY_ROUTES[K] row lookup to its own
// schema/invoke pairing; a union parameter degrades the row to an uninvokable intersection.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
async function handleUnary<K extends keyof RpcMethodMap>(
  api: ApiProxy, method: K, message: ClientRequest, signal: AbortSignal,
  principal: Principal, ownership: OwnershipLookup,
): Promise<Response> {
  const route = UNARY_ROUTES[method]
  const payload = route.schema.safeParse(message.payload)
  if (!payload.success) {
    return errorResponse(message.rpcId, { code: 'bad-request', message: `invalid payload for ${method}`, details: { issues: payload.error.issues } })
  }
  // Authorization runs after parsing because an `owner` policy resolves ids
  // out of the payload, and before dispatch because a refused call must not
  // reach the implementation at all.
  if (!await permitsPolicy(METHOD_POLICY[method], payload.data, principal, ownership)) {
    return errorResponse(message.rpcId, forbiddenError())
  }
  const request: AuthorizedRequest<RequestPayload<K>> = { rpcId: message.rpcId, payload: payload.data, principal }
  try {
    return fullResponse(await route.invoke(api, request, signal))
  } catch (error: unknown) {
    // The impl never throws business errors; reaching here means the implementation itself crashed — 500, carrier layer.
    return new Response(`handler failure: ${String(error)}`, { status: 500 })
  }
}

/** SSE frame: complete the narrow RpcRequest<frame> into a ServerRequest full form (method = frame type). */
function fullFrame(narrow: RpcRequest<MuxFrame | HostFrame>): ServerRequest {
  return { type: 'server-request', rpcId: narrow.rpcId, method: narrow.payload.type, payload: narrow.payload }
}

/**
 * Wrap a frame stream as an SSE Response; stops when req.signal aborts. An
 * impl throw mid-stream emits one stream/error frame and then closes.
 */
function sseResponse(frames: AsyncIterable<RpcRequest<MuxFrame | HostFrame>>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Send an SSE comment line on open so clients/proxies see a live channel (the host
        // stream has no baseline frames and would otherwise emit zero bytes while idle;
        // a comment line is not a frame, so client frame parsing skips it naturally).
        controller.enqueue(encoder.encode(': connected\n\n'))
        for await (const narrow of frames) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(fullFrame(narrow))}\n\n`))
        }
      } catch (error: unknown) {
        // Mid-stream impl failure → one stream/error frame, then close: the client must see
        // the failure instead of a silent end (which reads as a normal disconnect). A fresh
        // rpcId is minted — this is a server-initiated push like any other frame.
        const failure: MuxFrame | HostFrame = { type: 'stream/error', error: { code: 'internal', message: String(error), details: {} } }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(fullFrame({ rpcId: RpcId(randomUUID()), payload: failure }))}\n\n`))
        } catch {
          // Consumer already cancelled the stream: enqueue-after-cancel is the
          // only reachable error, and there is no one left to tell.
        }
      } finally {
        try {
          controller.close()
        } catch { /* already cancelled by the consumer: a double close is the only reachable error */ }
      }
    },
  })
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  })
}

/**
 * Wraps an ApiProxy into a pure fetch function (isomorphic point: feed the returned fetch straight to InProcessApiClient).
 * @param api - the host-side ApiProxy implementation.
 * @param authorization - who each request acts as and how ownership resolves; omitted, every request is the `local`
 *   principal and every policy passes.
 * @returns an object holding `fetch(Request)`; paths outside /api/ return 404.
 */
export function toFetchHandler(
  api: ApiProxy,
  authorization: RequestAuthorization = LOCAL_AUTHORIZATION,
): { fetch: typeof fetch } {
  return {
    // Signature matches global fetch: the isomorphic point hands this function to InProcessApiClient as its transport aspect,
    // Clients call in (url, init) form — normalize to Request before handling.
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const req = input instanceof Request ? input : new Request(input, init)
      const url = new URL(req.url)
      const path = url.pathname
      const principal = authorization.principalFor(req)
      const ownership = authorization.ownership

      // No-envelope read channels (SSE GET streams + host-only download):
      // physical routes that answer directly, without a wire envelope. The two
      // streams subscribe every session on the host, so the gateway decides
      // them frame by frame; the carrier only states whose stream it is.
      if (path === '/api/events.mux' && req.method === 'GET') {
        return sseResponse(api.events.mux({ rpcId: RpcId(randomUUID()), payload: {}, principal }, req.signal))
      }
      if (path === '/api/events.host' && req.method === 'GET') {
        return sseResponse(api.events.host({ rpcId: RpcId(randomUUID()), payload: {}, principal }, req.signal))
      }
      if (path === '/api/session.export' && (req.method === 'GET' || req.method === 'HEAD')) {
        // Query params are a different boundary from the POST envelope, but
        // the request still casts its brands only through the domain schema.
        const parsed = sessionLogQuerySchema.safeParse(Object.fromEntries(url.searchParams))
        if (!parsed.success) {
          return new Response('missing or invalid sessionId query parameter', { status: 400 })
        }
        // The export streams one session's complete log; it is the download
        // face of `session.history` and carries the same `owner` policy.
        if (!await permitsPolicy('owner', parsed.data, principal, ownership)) {
          return new Response('forbidden', { status: 403 })
        }
        const response = await api.downloads.sessionLog(parsed.data, req.signal)
        if (req.method === 'GET') return response
        await response.body?.cancel()
        return new Response(null, { status: response.status, headers: response.headers })
      }

      if (req.method !== 'POST' || !path.startsWith('/api/')) {
        return new Response('not found', { status: 404 })
      }

      // Cross-site write fence: browsers send "simple" POSTs (text/plain,
      // form encodings) without a CORS preflight, so a malicious page could
      // otherwise execute side-effectful RPCs blind — the response stays
      // unreadable cross-origin, but session.prompt would still run. Only the
      // JSON media type is accepted; anything else is forced into a preflight
      // this server never answers. 415 = carrier layer, like the 400 below.
      const mediaType = req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }

      let body: unknown
      try {
        body = await req.json()
      } catch {
        // 400 = carrier layer (body is not even JSON); valid JSON with a bad shape goes 200 + bad-request.
        return new Response('body is not JSON', { status: 400 })
      }

      if (path === '/api/respond') {
        const parsed = clientResponseSchema.safeParse(body)
        if (!parsed.success) return Response.json({ accepted: false, reason: 'bad-response' })
        // No policy row: a response addresses a pending server request by its
        // unguessable rpcId, which relates to no session, workspace, or
        // account. Reaching this carrier at all is the authorization — an
        // unauthenticated request is refused by the transport before dispatch.
        return Response.json(await api.respond(parsed.data))
      }

      const method = methodFor(path.slice('/api/'.length))
      if (method === undefined) return new Response('not found', { status: 404 })

      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success) {
        // Best effort at correlation: salvage a string rpcId from the raw body;
        // otherwise the fixed sentinel keeps the response a valid ServerResponse.
        const rawId = (body as { rpcId?: unknown } | null)?.rpcId
        const rpcId = typeof rawId === 'string' ? RpcId(rawId) : INVALID_REQUEST_RPC_ID
        return errorResponse(rpcId, { code: 'bad-request', message: 'invalid client-request message', details: { issues: envelope.error.issues } })
      }
      const message: ClientRequest = envelope.data
      if (message.method !== method) {
        return errorResponse(message.rpcId, { code: 'bad-request', message: `method "${message.method}" does not match path "${method}"`, details: { issues: [] } })
      }
      return handleUnary(api, method, message, req.signal, principal, ownership)
    },
  }
}
