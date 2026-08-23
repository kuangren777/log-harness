# dsh-mail

English | [中文](README.zh.md)

Service Definition of the [outbound mail](../README.md) capability seam: one abstract `MailService` on `ctx.mail`, one `send` operation, and one message record every provider accepts.

## Service API

```ts
import { Service } from '@deepseek-ai/cordis'
import type { MailMessage } from '@deepseek-ai/dsh-mail'

abstract class MailService extends Service {
  abstract send(message: MailMessage): Promise<void>
}
```

`send` resolves once the provider accepted the message for delivery — an SMTP server acknowledged it, a mailbox write reached disk. That handoff is the strongest fact a sender can report: a bounce arrives minutes later at an address this seam never sees, so no provider promises receipt.

| `MailMessage` field | Meaning |
|---|---|
| `to` | Recipient address, in the form the mounted provider's transport accepts. |
| `subject` | Subject line, sent verbatim. |
| `text` | Plain-text body, always present. |
| `html` | Richer alternative body; absent leaves the message text-only. |

## What the seam deliberately does not own

**Address grammar.** `to` reaches the provider as the caller typed it. A same-process caller already satisfies `MailMessage` by type, and the transport behind the provider — an SMTP server's `RCPT TO`, a file the tests read back — is the boundary that accepts or rejects an address. A second parser here would only disagree with the component that decides.

**Sender identity.** `from` is provider configuration, never a message field: one mounted provider sends as one address, so a consumer cannot pick a different sender by composing a different record.

**Templates.** Rendering a body, choosing a locale, and looking a recipient up belong to the consumer that decides what to send; the seam moves finished content.

## Model Experience

None, as the seam delivers operator-facing mail: no message body, delivery result, or configuration value enters a model request, and no consumer of `ctx.mail` is mounted in a shipped composition.

#### KV Cache effect

None; the package contributes no request content, so no prefix can be invalidated.

## Known Limitations and Deferred Work

- **Single recipient, no cc/bcc or attachments** — `MailMessage` carries one `to`; a consumer needing several recipients sends several messages. The fields exist when a consumer needs them, not before.
- **No delivery record** — `send` emits no event and writes nothing durable, so a caller that must audit what was mailed keeps its own record. The seam gains an event with the first consumer that needs one logged.
