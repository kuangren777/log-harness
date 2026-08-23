# Agent Note: The authenticated request gate

Status: implemented

English | [中文](2026-08-23-auth-request-gate.zh.md)

## Problem

[The auth capability](2026-08-23-auth-capability-design.md) landed users, groups, and rules, but nothing consulted them. The Host still answered every request that cleared the browser-trust fence, and that fence answers "did this come from a declared authority", not "who is asking". A deployment serving several people over a tailnet needed a point where a request acquires an identity and a refusal that no client can talk its way past.

## Decision

### The policy table is compiler-locked

`METHOD_POLICY` in [fetch/handler.ts](../../../../packages/host/apiproxy/src/fetch/handler.ts) is typed `{ [K in keyof RpcMethodMap]: PolicyRow<K> }` and sits beside the `UNARY_ROUTES` dispatch table. A new RPC method therefore **fails to compile until someone decides who may call it**. This is the difference between a security control and a checklist: an allowlist maintained by discipline drifts the first time someone adds a method in a hurry, while this one cannot be forgotten because the build stops.

`PolicyRow` narrows further. `owner` is offered only for a method whose payload actually addresses something ownable:

```ts ignore-check
type OwnerCapable<K> = [Extract<keyof RequestPayload<K>, OwnableIdKey>] extends [never] ? never : 'owner'
```

Without that, declaring `owner` on a method carrying no id would silently admit every authenticated caller — the worst kind of bug, one that reads as enforcement. The type makes it unrepresentable.

### Three fence sites, not one

The fence runs in [connection/src/index.ts](../../../../packages/client/connection/src/index.ts) at the `/api` unary route and at **both** WebSocket upgrade paths. Product event streams are WebSocket, not SSE, so gating only the fetch route would have left the mux and host streams open to any peer that reached the port — an authenticated-looking deployment still leaking every session's transcript. Authentication is applied at all three.

### Streams filter, listings narrow, subagents refuse

Three different answers, each matching what the caller asked:

- `events.mux` subscribes every session to every client, so it **filters frames** by ownership; refusing the connection would break the feature for a legitimate user.
- `session.list`, `session.search`, and `workspace.list` are `user` and **narrow their answer**: they are questions across accounts, and refusing them wholesale would be wrong.
- The subagent methods are `owner` on `parentSessionId` and **refuse**. A subagent catalog is a projection of one parent conversation and children carry no ownership rows of their own, so filtering would always return empty and quietly break the feature.

### The cookie carries an id and a token

`dsh_session` holds `<authSessionId>.<token>`. `authenticateToken` returns a `Principal` and nothing else, so without the id half a plain `logout` could only be implemented as `revokeAllSessions` — logging a user out of every device because they closed one tab. The id is an unguessable UUID whose only power is revocation, and **revocation derives it from the validated cookie, never from a request payload**: taking it from a parameter would let anyone who learned another user's session id log them out.

A token is minted only in `login.verify`. A pre-login cookie is never adopted, which is what closes session fixation.

### Absent auth means `local`, so nothing changed

When no gate is mounted, `toFetchHandler` receives no `RequestAuthorization` and every request is the `local` principal. Existing deployments, the CLI, ACP automation, and every keyless snapshot behave exactly as before — which is why this landed without touching a single existing expectation. Authorization is a composition choice, not an upgrade.

## Alternatives considered

**Enforce in the client and keep the Host permissive.** Rejected outright. Hiding a control is a courtesy to the person using the page; the refusal that matters happens where the operation runs. Every policy here is server-side, and the tests call the dispatch layer directly, with no browser involved.

**A hand-maintained list of privileged methods.** Rejected — that is `PRIVILEGED_METHODS`, which already exists as a fence-level defense. It stays as defense in depth, but it cannot be the authorization mechanism because nothing forces a new method into it.

**Put the IP in the audit record as a required field.** Rejected. `req.socket?.remoteAddress` is best-effort: the socket can be gone, and six pre-existing tests construct request doubles without one. Rate limiting keys on the e-mail as well, so a missing address weakens nothing.

## Consequences

Authorization now has one home per question: the policy table decides who may call a method, the implementation decides which rows they see, and the fence still decides which origins may reach the port at all. Enforcement of group rules over skills, tools, models, and settings sections is deliberately not here — it hangs off this gate in the stage that follows.
