# 邮件发送

[English](mail.md) | 中文

[`dsh-mail`](../../packages/mail/mail) 是出站邮件能力接缝：`ctx.mail` 上的一个抽象 `MailService`，只有一个 `send` 操作。调用方组装好一条 `MailMessage` 并交出去；被挂载的提供方拥有传输方式、发件人身份，以及投递所需的每一份凭据，因此组合文件里从不出现 SMTP 端点，也不会为发一封信而携带任何密钥。[`dsh-mail-smtp`](../../packages/mail/mail-smtp) 与 [`dsh-mail-file`](../../packages/mail/mail-file) 是两个提供方；同一时间只挂载一个，且默认都不会组合进已发布的部署。

Source: [`packages/mail/mail/src/index.ts`](../../packages/mail/mail/src/index.ts)

## 消息记录

`to`、`subject`、`text` 始终存在；`html` 是可选的富文本替代内容，缺省时消息只有纯文本。该接缝不拥有任何地址语法——`to` 会按调用方原样传给提供方，而提供方背后的传输层（SMTP 服务器的 `RCPT TO`、测试读回的一个文件）才是接受或拒绝它的边界。

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

## 投递

`send` 在提供方接受消息投递后才会完成——SMTP 服务器确认了收到，或者一次写入到达了邮箱文件——这是发送方能报告的最强事实；这次交接之后发生的事，该接缝一概观察不到，也没有任何提供方承诺最终送达。发件人身份属于提供方配置，从不属于消息本身：一个已挂载的提供方只以一个 `from` 发送，因此调用方无法通过组装不同的记录来伪造另一个发件人。[`dsh-mail-smtp`](../../packages/mail/mail-smtp/README.zh.md) 用[凭据引用](credentials.zh.md)认证，从不在配置里出现字面密钥；[`dsh-mail-file`](../../packages/mail/mail-file/README.zh.md) 完全不需要任何凭据。

`dsh-mail-file` 会把每条消息追加为配置好的邮箱文件中的一行紧凑 JSON 对象——单元测试、无密钥快照与浏览器端流程都靠解析这个格式来读回本系统发出过什么，最常见的情形是从一封登录邮件里取回一次性验证码。这个行格式是调用方要解析的契约，逐字段记录在[其 README](../../packages/mail/mail-file/README.zh.md)；本页不重复记录。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
