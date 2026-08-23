# Agent Note: The browser learns it must sign in from a 401, and never decides anything else

Status: implemented

English | [中文](2026-08-23-browser-login.zh.md)

## Problem

The [request gate](2026-08-23-auth-bootstrap-cli.md) made a `dsh web` deployment refusable: an unauthenticated `/api` request answers 401 and a WebSocket upgrade is refused the same way. Nothing in the browser knew what to do with that. The shell saw a transport failure, entered its reconnect loop, and retried a request that would be refused identically forever, so an authenticating deployment presented as a broken one.

The surface that fixes this has to satisfy two constraints that pull apart. It must be present in the shipped Web composition, because a deployment opts into authentication with a `--patch` overlay that adds host rows and cannot add browser rows to an already-built bundle. And it must be completely invisible in the single-tenant default, which is every deployment that does not layer that overlay.

## Decision

`@deepseek-ai/dsh-client-ui-auth` is a shipped row of the Web bundle. It registers two seats — the sign-in card in `shell.overlay` and the account row in `sidebar.footer.action` — over one controller, and the controller's first act is `me` on the gate's `/auth` channel.

Absence is what makes the default deployment quiet. `/auth` is a channel the gate registers; without the gate there is no route, the call fails at the transport, and the controller records `mounted: false` and hides both seats for the page's life. No configuration key selects this, and no host row has to be added in step with the overlay: the same bundle behaves both ways because the question it asks has two honest answers.

### The 401 seam is a latch the transport does not act on

`WebApiClient.doFetch` observes `response.status === 401` and calls one optional callback; the response continues to the caller as the same transport failure it always was. The plugin body turns that callback into `ctx.connection.authRequired`, a bare observable source beside the existing `hostDescription`, and `ui-auth` is its only reader.

The signal latches — one false-to-true transition, never cleared. A deployment that refused once refuses every later call, and the credential that would change the answer arrives through a page the sign-in surface reloads, so there is no state to return to. Keeping it monotonic removes the reset path a consumer would otherwise have to get right.

On the flip, the surface does not open the form directly; it calls `me`. The refusal may have raced a sign-in that already succeeded in another tab, and the Host is the only thing that knows.

### The UI decides nothing about authorization

By the time the card is visible the Host has already refused. Everything the surface shows is an answer the gate gave — whether a cookie authenticates, whether a password started a challenge, whether a code redeemed, whether a token was still good. There is no client-side permission check, no rights model, and no hidden control: an operation the signed-in account may not perform is refused by the gateway's policy table, not by a component that decided not to render a button.

That is also why signing in and signing out reload the page. Re-authenticating a live connection would mean re-driving the shell's whole post-connect sequence with streams already open under the old credential, which is a second, weaker version of the boot the browser already performs correctly.

### Generic failure copy is part of the contract, not a wording choice

The gate answers a wrong password, an unknown address, a disabled account, and an expired code with one shapeless `failed`, precisely so a sign-in form cannot enumerate accounts. Copy that said "no account with that address" would rebuild the oracle the server refuses to be, on the client, where nobody would think to look for it.

So one string covers all of those cases, a reset request is acknowledged with "if that address has an account", and a rate-limited refusal reads "try again later" with no count, deadline, or attempt total — the deadline the Host reports selects the wording and is never rendered. The unit suite pins this: the two refusal causes must produce the identical notice, and the strings are checked against the phrasings that would give one away.

### Fixture support is opt-in

The fixture client serves `/auth` only under `?fixtureAuth=on`. A fixture page is a deployment with no request gate, and every existing fixture journey asserts a shell with no sign-in card in front of it; serving the channel by default would have put one there.

## Consequences

`ConnectionHandle` gained a member, so every hand-built fake of it in the client suites now supplies an `authRequired` source; the two in `packages/client/runtime/tests` were updated with this change.

A deployment with no request gate pays one extra thing at boot: a failed POST to `/auth/me`, whose rejection is the answer. It is one request per page load, and it is what keeps the two deployment shapes on one bundle.

The sign-in surface owns the two mailed link paths (`/reset-password`, `/verify-email`). They are matched against `location.pathname` inside this package rather than routed, because the shell has no router; a future one has to take these two paths with it.

Nothing here covers administration. Creating accounts, managing groups, and editing rules stay outside the browser, and the account row deliberately shows only what `me` reports about the signed-in account.

## Alternatives considered

**Parsing the transport error message for "HTTP 401".** Rejected: the status is structured information available at the one place that already has the `Response`, and reading it back out of a string couples the sign-in surface to the wording of an error thrown three layers away.

**Translating the 401 into a resolved "unauthenticated" result inside the API client.** Rejected because it changes what every existing caller sees. A refused call is a failed call; the sign-in surface needs to know about it, and no other caller should have to learn a new success shape.

**Making the auth row an overlay-added browser row.** Rejected: `dsh.client` rows are scanned into the boot manifest and served from built bundles, so a `--patch` overlay adding one would need the package built and resolvable at the deployment, while the shipped bundle would still have to tolerate its absence. Shipping it always, hidden, is one behavior instead of two.

**Clearing `authRequired` after a successful sign-in.** Rejected as unreachable state: the successful path reloads the page, which discards the flag with everything else. A clear path would exist only to be untested.

**Showing the account row inside Settings rather than at the sidebar foot.** Rejected because signing out is not configuration, and a person who needs to leave a shared machine should not have to open a modal to do it.

**A first-class "session expired" toast instead of the card.** Rejected: the app behind it cannot serve a single request, so a dismissible notice would leave the user in a shell where everything fails silently.
