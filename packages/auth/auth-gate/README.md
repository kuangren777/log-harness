# dsh-auth-gate

English | [中文](README.zh.md)

Consumer of the [authentication and authorization](../README.md) seam: the plugin that turns [`AuthService`](../auth/README.md) into something a browser can use. It serves the `/auth` sign-in channel and provides `ctx.authGate`, which the HTTP transport asks before it admits any request.

It decides who a request is, never what that request may do. The permitted operations are the gateway's [policy table](../../host/apiproxy/README.md); this package answers only the first question, and how a browser comes to have an answer to present.

The plugin injects `auth`, `connection`, and `mail`, all three without a fallback. A composition that mounts the gate without a mail provider could deliver no second factor, so the plugin stays inactive rather than signing anyone in through a weakened flow.

| `Config` field | Meaning |
|---|---|
| `baseUrl` | Absolute origin every mailed link resolves against. No default: a link to the wrong origin either fails to open or sends a one-time token elsewhere. |
| `cookieName` | Session cookie name; default `dsh_session`. |
| `cookieSecure` | Whether the cookie carries `Secure`; default `true`. |
| `codeTtlMs` | Second-factor code lifetime; default 10 minutes. |
| `linkTtlMs` | Reset and confirmation link lifetime; default 1 hour. |

## Three fences, at three different grains

**Admission**, in [`dsh-client-connection`](../../client/connection/README.md). Every `/api` request and every event-stream upgrade resolves to a principal before it is served. Three outcomes: no auth provider and no gate admits `local`, which is what keeps a single-tenant deployment behaving as it did before this package existed; a gate that authenticates the credential admits that user; and a provider mounted **without** a gate stops the host serving at all, because such a composition means to authenticate and cannot. A refusal clears the cookie, so a browser stops resending a credential this host will never accept again.

**Method policy**, in the gateway's `METHOD_POLICY`. Each RPC method is `user`, `admin`, or `owner`.

**Frame visibility**, in the gateway's stream filter. Both server-to-browser streams subscribe every session on the host, so they cannot be secured by refusing the connection; each frame is dropped or narrowed on its way out instead.

## Why the policy table is compiler-locked

`METHOD_POLICY` is typed `{ [K in keyof RpcMethodMap]: PolicyRow<K> }`, so a new method fails to compile until it is given a policy, in the same file and the same edit as its route row. An `owner` row must also name a payload key ownership can be resolved from, which is what makes those rows checkable rather than decorative. A default would have been the dangerous shape here: the method that someone forgets is exactly the one that must not silently become reachable.

`subagent.list` is `owner` on `parentSessionId` and refuses, rather than returning a filtered catalog. A subagent catalog is a projection of one parent conversation and the children carry no ownership rows of their own, so owning the parent is the whole question — there is no per-child fact left to filter on.

## The cookie

The credential is `<authSessionId>.<token>`, split at the first separator, under `HttpOnly; SameSite=Strict; Path=/`. `SameSite=Strict` is the cross-site fence that makes the gateway's state-changing methods safe without a CSRF token.

The id half is safe to carry. The seam resolves a token to a principal but offers no token-to-session lookup, so without the id a sign-out could only revoke every session the account has. Presenting the id authenticates nothing, and the single operation it can name is the revocation of a session whose id the caller already holds.

Revocation still never trusts it as input. `logout` derives the session id from the cookie the request already authenticated with, and no endpoint accepts a session id in its payload, so one account cannot sign another out.

## Generic failure

No endpoint distinguishes an unknown address from a wrong password, an expired code from a wrong one, or a consumed link from a forged one. `password.forgot` answers the same acknowledgement whether or not the address has an account, and swallows the provider's rate-limit refusal into that same answer rather than reporting it — a distinguishable refusal would confirm the address exists. The one fact a failure may carry is a lockout deadline, which is counted against the submitted address whether or not it names an account.

A bearer token is minted in exactly one place, `login.verify`, so a cookie a caller already holds can never be upgraded into an authenticated one. Redeeming a `verify-email` link is what records the confirmation: the provider writes it in the transaction that consumes the secret, so the gate has no second write that could fail to happen.

## Model Experience

None, as the gate authenticates Host requests and mails sign-in messages; no principal, cookie, or mailed text enters a model request, and the package registers no tool, prompt section, or session event.

#### KV Cache effect

None; the package contributes no request content, so no prefix can be invalidated.

## Known Limitations and Deferred Work

- **No self-service registration** — accounts are created by `dsh auth bootstrap` or by an administration surface; the channel serves sign-in, sign-out, reset, and confirmation only.
- **Group-change notices need a caller** — `notifyAddedToGroup` owns the template but not the trigger, because the seam publishes no membership event; whichever surface changes membership has to call it.
- **Opt-in composition only** — no shipped profile mounts this plugin. Layering it is documented in [`examples/web-auth/`](../../../examples/web-auth/README.md).
