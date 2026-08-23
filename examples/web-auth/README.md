# Multi-user Web

English | [中文](README.zh.md)

This overlay opts one `dsh web` process into [authentication](../../packages/auth/README.md) without changing the shipped default Web composition, which stays single-tenant:

```sh
dsh auth bootstrap --email you@example.test
dsh web --patch examples/web-auth/cordis.yml
```

The bootstrap command comes first and runs once. It creates the first administrator account in `$DSH_HOME/auth.db`, the same database the overlay points the provider at; with the overlay layered on an empty database, nobody can sign in and no request is served.

It mounts three rows, and all three are required. `dsh-auth-sqlite` stores accounts, groups, rules, sessions, one-time secrets, and the audit log. A mail provider delivers the sign-in code and the confirmation and reset links. [`dsh-auth-gate`](../../packages/auth/auth-gate/README.md) serves the `/auth` channel and answers the transport's per-request question. A composition that mounts the provider without the gate means to authenticate and cannot, so the host refuses to serve at all rather than serving every caller anonymously.

Layering the overlay is what puts a login screen in front of the app. The shipped Web composition already carries [`dsh-client-ui-auth`](../../packages/client/ui-auth/README.md), which stays invisible while nothing serves the gate's `/auth` channel; with the overlay on, the browser opens on the sign-in card instead of a conversation, and the sidebar foot grows an account row with **Sign out** and **Sign out everywhere**.

Signing in takes two steps: the password, then a six-digit code sent by mail. The browser is left holding an `HttpOnly; SameSite=Strict` session cookie, and every `/api` request and event-stream upgrade is authenticated from it. What an authenticated caller may then reach is the [gateway's policy table](../../packages/host/apiproxy/README.md), not this overlay.

## Administering the other accounts

The first administrator administers everyone else from the browser. **Settings → Access**, contributed by [`dsh-client-ui-settings-access`](../../packages/client/ui-settings-access/README.md), lists every account and every permission group, creates and disables accounts, creates and renames and deletes groups, moves accounts between them, and edits the rules a group carries. The section is present for everybody and renders one explanatory paragraph for anyone the gate does not name an administrator; hiding it is a courtesy, and the refusal that matters is the gateway's, which rejects all nine `auth.admin.*` methods from a non-administrator.

Rules are where a deployment gets itself into trouble. A domain no rule addresses is fully open, and the first rule addressing it turns that whole domain into an allowlist — so a lone `deny secret-skill` denies every skill the group has, not one. The Access page seeds an `allow *` rule beside a domain's first denial, warns by name when a domain admits nothing, and previews the real skill catalog as a member of the group would see it before anything is saved.

The reset and confirmation links the gate mails resolve against `baseUrl` and land back in the same app, so that value must name the origin the browser actually reaches.

## Before anyone else signs in

`mail-file` writes the mailbox to `$DSH_HOME/mailbox.jsonl` as one JSON line per message. That is a working local trial and a second-factor bypass for anyone who can read the file, so a deployment with more than one account swaps in `@deepseek-ai/dsh-mail-smtp`.

`cookieSecure: false` is in the overlay because the default `baseUrl` is loopback HTTP, where a `Secure` cookie would never be sent at all. It stays correct only over loopback or inside an encrypted tailnet where the origin is unreachable from the open network. Any other deployment sets `baseUrl` to its own HTTPS origin and drops the line, restoring the `true` default.

`baseUrl` must match the origin the browser actually reaches, including port: it is the base every mailed link resolves against.
