# dsh-mail-smtp

English | [中文](README.zh.md)

SMTP [mail](../mail/README.md) provider over [nodemailer](https://nodemailer.com). Composition files carry the endpoint and the *names* of the credentials; the values stay in the [credentials](../../credentials/credentials/README.md) seam.

## Config

| Field | Default | Meaning |
|---|---|---|
| `host` | required | SMTP server hostname. |
| `port` | required | SMTP server port. |
| `secure` | required | `true` starts the connection in TLS (implicit TLS, normally port 465); `false` upgrades with STARTTLS when the server offers it. |
| `from` | required | `From` address every message is sent as. |
| `userRef` | omitted | Name of the credential reference holding the SMTP username. |
| `passwordRef` | omitted | Name of the credential reference holding the SMTP password. |

```yaml
- @deepseek-ai/dsh-mail-smtp:
    host: smtp.example.com
    port: 587
    secure: false
    from: Harness <no-reply@example.com>
    userRef: DSH_SMTP_USER
    passwordRef: DSH_SMTP_PASSWORD
```

`userRef` and `passwordRef` are reference *names*, never secrets: `DSH_SMTP_PASSWORD` is what the composition file says, and the value behind it lives wherever the mounted credentials provider keeps it. Omit both for a relay that accepts unauthenticated mail; configuring exactly one fails at load, because SMTP AUTH needs both halves.

## Credential resolution

Both references resolve through `ctx.credentials` on **every** send, so a rotated password reaches the next message without restarting the harness. Two failures are loud and name the reference without ever printing its value:

- the reference resolves to nothing — `mail-smtp: credential reference "DSH_SMTP_PASSWORD" is not configured; store it through the credentials service`;
- no credentials service is mounted at all, which a composition that configured references cannot have meant.

A reference outside the credential grammar fails earlier still, when `resolveSpec` brands it at load, where the composition file carrying the typo is the thing being read.

## Connection reuse

One transport — and therefore one nodemailer connection pool — serves every send whose resolved login is unchanged. A rotation produces a different login, which closes the open transport before the next one opens, so a retired password never keeps a live authenticated connection. Disposal closes whichever transport is live and refuses later sends; a second disposal finds none.

The provider logs one debug line per opened transport, naming the host, the port, and the *reference name* it authenticates from. Resolved usernames and passwords are never logged.

## Why nodemailer

SMTP framing, STARTTLS negotiation, AUTH mechanism selection, MIME assembly for the `text`/`html` alternative, and header encoding are a protocol surface this repository would otherwise own outright, together with the tests that keep it honest against real servers. nodemailer is maintained, MIT-0, and has no runtime dependencies, so the deletion costs nothing in supply-chain surface ([dependency policy](../../../.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md)). The provider depends on exactly two of its operations, declared as the `MailTransport` interface, which is also what lets the suite drive the provider without an SMTP server.

## Model Experience

None, as the provider delivers operator-facing mail: message content, credentials, and delivery errors stay on the host, and no shipped composition mounts it.

#### KV Cache effect

None; the package contributes no request content, so no prefix can be invalidated.

## Known Limitations and Deferred Work

- **No delivery retry** — a rejected `sendMail` rejects `send`; the caller decides whether to retry. Nothing here distinguishes a transient 4xx from a permanent 5xx.
- **Password AUTH only** — the two references model user/password login. OAuth2 SMTP tokens would need a different resolution path (a credential record, refreshed), which no consumer asks for yet.
- **No pool sizing or timeout config** — nodemailer's defaults apply; the connection knobs become `Config` fields when a deployment needs them.
