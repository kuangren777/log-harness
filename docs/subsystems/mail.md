# Outbound Mail

English | [中文](mail.zh.md)

[`dsh-mail`](../../packages/mail/mail) is the outbound mail capability seam: one abstract `MailService` on `ctx.mail` with a single `send` operation. A consumer composes a finished `MailMessage` and hands it over; the mounted provider owns the transport, the sender identity, and every credential the delivery needs, so composition files never carry an SMTP endpoint or a secret to send one message. [`dsh-mail-smtp`](../../packages/mail/mail-smtp) and [`dsh-mail-file`](../../packages/mail/mail-file) are the two providers; one is mounted at a time, and neither composes into a shipped deployment by default.

Source: [`packages/mail/mail/src/index.ts`](../../packages/mail/mail/src/index.ts)

## The message record

`to`, `subject`, and `text` are always present; `html` is an optional richer alternative that leaves the message text-only when absent. The seam owns no address grammar — `to` reaches the provider exactly as the caller typed it, and the transport behind the provider (an SMTP server's `RCPT TO`, a file the tests read back) is the boundary that accepts or rejects it.

```ts type-equiv
/**
 * One outbound message, addressed and already rendered. Templating, locale
 * selection, and recipient lookup belong to the consumer that composes the
 * message; a provider receives finished content and delivers it.
 */
interface MailMessage {
  /** Recipient address, in the form the configured provider's transport accepts. */
  readonly to: string
  /** Subject line, sent verbatim. */
  readonly subject: string
  /** Plain-text body, always present so a recipient without HTML still reads the message. */
  readonly text: string
  /** HTML body offered as the richer alternative to {@link text}; absent leaves the message text-only. */
  readonly html?: string
}
```

## Delivery

`send` resolves once the provider has accepted the message for delivery — an SMTP server acknowledged it, a mailbox write reached disk — which is the strongest fact a sender can report; nothing downstream of that handoff is observable through this seam, and no provider promises final receipt. The sender identity is provider configuration, never part of a message: one mounted provider sends as one `from`, so a consumer cannot spoof another sender by composing a different record. [`dsh-mail-smtp`](../../packages/mail/mail-smtp/README.md) authenticates from [credential references](credentials.md), never literal secrets in configuration; [`dsh-mail-file`](../../packages/mail/mail-file/README.md) needs no credential at all.

`dsh-mail-file` appends one compact JSON object per line to a configured mailbox file — the format unit suites, keyless snapshots, and browser journeys parse to read back what the harness sent, most commonly a one-time code from a sign-in mail. The line format is a contract consumers parse, documented field by field at [its README](../../packages/mail/mail-file/README.md); this page does not restate it.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmail--mailservice-abstract-seam"></a>

### `ctx.mail` — `MailService` (abstract seam)

Abstract outbound mail service: one delivery operation over one configured sender.

The seam owns no address grammar. `to` reaches the provider as the caller typed it, and the transport behind the provider — an SMTP server's `RCPT TO`, a file the tests read back — is the boundary that accepts or rejects it. A same-process caller already satisfies MailMessage by type, and a second address parser here would only disagree with the transport that decides.

The sender identity is provider configuration, never part of a message: one mounted provider sends as one `from`, so a consumer cannot spoof another sender by composing a different record.

```ts cordis-catalog
/**
 * Deliver one message. The returned promise settles after the provider
 * accepted the message for delivery — an SMTP server acknowledged it, a file
 * write reached the mailbox — which is the strongest fact a sender can
 * report; nothing downstream of that handoff is observable here.
 * @param message - the finished message to deliver.
 * @returns a promise resolving once the provider accepted the message, rejecting when delivery failed.
 */
abstract send(message: MailMessage): Promise<void>
```

Source: [`packages/mail/mail/src/index.ts`](../../packages/mail/mail/src/index.ts)
<!-- END GENERATED cordis-surface -->
