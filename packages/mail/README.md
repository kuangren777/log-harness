# mail/ — outbound mail capability family

English | [中文](README.zh.md)

This family delivers one finished message through a swappable transport, with the sender identity and every credential owned by the mounted provider.

| Package | Role | ctx key |
|---|---|---|
| [`mail/`](mail/README.md) | Defines the message record and the single `send` operation | `ctx.mail` |
| [`mail-smtp/`](mail-smtp/README.md) | Delivers over SMTP through nodemailer, authenticating from credential references | provides `ctx.mail` |
| [`mail-file/`](mail-file/README.md) | Appends one JSON line per message to a local mailbox file | provides `ctx.mail` |

One provider is mounted at a time: `ctx.mail` names one sending identity, and a composition chooses between a real relay and a readable mailbox rather than fanning one message out to both.

No package here composes messages. Subject lines, bodies, and templates belong to the consumer that decides what to send, so a template change never touches a transport.
