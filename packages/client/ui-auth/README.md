# dsh-client-ui-auth

English | [中文](README.zh.md)

The browser side of signing in: the two-step login card, the two mailed landings, and the account row at the sidebar foot. It is the client half of [`dsh-auth-gate`](../../auth/auth-gate/README.md), and it owns no decision of its own — the Host has already refused a request by the time anything here is visible.

Mounting the row is harmless in a deployment that does not authenticate. The first thing the plugin does is call `me` on the gate's `/auth` channel; a deployment that mounts no gate has no such route, the call fails at the transport, and every surface stays hidden for the page's life.

## Signing in

The card fills the shell's overlay layer and takes pointer events, because the app behind it cannot be used until the Host knows who is asking. At 640px and below it keeps the same width rule but drops its surround to what a 360px screen can spare, honours the display's safe areas, and pins itself to the top of the scrolling backdrop — a centered flex item overflows its scroll container's start edge, so a step taller than the screen would otherwise be unreachable at both ends. It appears in two situations: the boot read said the cookie authenticates nobody, and the transport reported that an `/api` call was refused as unauthenticated.

Signing in takes two steps. The address and password go to `login.start`; on `2fa-required` the card asks for the six-digit code the Host mailed and sends it to `login.verify`. Success installs the session cookie server-side, and the page re-boots under it — every surface and both event streams were opened as nobody, so continuing without a reload would leave half the app talking with a credential it does not have.

Both ways out sit in the account row: **Sign out** calls `logout` and ends this browser's session; **Sign out everywhere** calls `logoutEverywhere` and ends every session the account has. Each is followed by the same page re-boot.

## The mailed links

The gate mails absolute links against its configured `baseUrl`, and this package answers the two paths they point at. `/reset-password?email=…&token=…` opens the new-password form and redeems the token through `password.reset`. `/verify-email?token=…` redeems the token through `email.verify` and reports only whether it redeemed. A link missing the token, or missing the address the reset needs, falls back to the ordinary sign-in rather than half-opening a form that cannot be submitted.

## What a failure is allowed to say

The gate answers a wrong password, an address with no account, a disabled account, and an expired code with one shapeless `failed`, so that a sign-in form cannot be used to find out which addresses have accounts. This package keeps that property in the copy: one string covers every one of those cases, and a reset request is acknowledged with "if that address has an account" rather than a confirmation. A refusal the Host attributed to a rate limit is shown as "try again later" — never as a count, a deadline, or an attempt total.

Every submit is disabled and reports progress while its request is in flight, so a step cannot be sent twice.

## The 401 seam

`dsh-client-connection` publishes `ctx.connection.authRequired`, a latched observable that flips the first time an `/api` answer is 401. The transport does nothing with it — the caller still sees the same transport failure it always did — and this package is its only reader. When it flips, the card asks the Host `me` rather than assuming: the refusal may have raced a sign-in that already succeeded in another tab.

## Model Experience

None, as the sign-in surface renders the request gate's answers in the browser: no address, password, code, or session fact enters a model request.

#### KV Cache effect

None; the package contributes no request content, so no prefix can be invalidated.

## Known Limitations and Deferred Work

- **A changed credential costs a page re-boot** — sign-in and both sign-outs reload the page rather than re-driving the shell's post-connect sequence, because the object layer offers no seam for re-authenticating a live connection; the streams would otherwise keep running under the credential they were opened with.
- **No administration surface** — accounts, groups, and rules belong to [`dsh-client-ui-settings-access`](../ui-settings-access/README.md); this package covers only what the signed-in person does with their own account.
- **The account row shows an address, not a session inventory** — `me` reports the account and its groups, and the gate publishes no list of a user's other live sessions, so "sign out everywhere" cannot say how many it ended.
- **A non-HTTP carrier never reports 401** — the worker-preview transport supplies its own API client and no HTTP status reaches the latch, so a sign-in surface there would have to be opened by the boot read alone.
