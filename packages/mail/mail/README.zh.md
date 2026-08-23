# dsh-mail

[English](README.md) | 中文

[外发邮件](../README.zh.md)能力 seam 的 Service Definition：`ctx.mail` 上一个抽象 `MailService`、一个 `send` 操作，以及所有提供方都接受的一份邮件记录。

## 服务 API

```ts
import { Service } from '@deepseek-ai/cordis'
import type { MailMessage } from '@deepseek-ai/dsh-mail'

abstract class MailService extends Service {
  abstract send(message: MailMessage): Promise<void>
}
```

`send` 在提供方受理该邮件后 resolve——SMTP 服务器已确认，或信箱写入已落盘。这个交接点是发送方能报告的最强事实：退信要在几分钟后到达一个本 seam 永远看不到的地址，因此没有任何提供方承诺送达。

| `MailMessage` 字段 | 含义 |
|---|---|
| `to` | 收件地址，形式由挂载提供方的传输通道接受。 |
| `subject` | 主题行，原样发送。 |
| `text` | 纯文本正文，始终存在。 |
| `html` | 更丰富的替代正文；缺省时邮件仅含文本。 |

## 本 seam 刻意不持有的东西

**地址语法。** `to` 按调用方书写的原样送达提供方。同进程调用方在类型上已满足 `MailMessage`，而决定一个地址是否被接受的是提供方背后的传输通道——SMTP 服务器的 `RCPT TO`，或测试读回的那个文件。在这里再放一个解析器只会与真正做决定的组件产生分歧。

**发件人身份。** `from` 是提供方配置而非邮件字段：一个挂载的提供方以一个地址发信，因此消费方无法通过组装不同的记录改换发件人。

**模板。** 渲染正文、选择语言、查找收件人属于决定发什么的消费方；本 seam 只搬运已完成的内容。

## 模型体验

无：本 seam 投递的是面向运维者的邮件，任何邮件正文、投递结果或配置值都不会进入模型请求，随产品发布的组合中也没有挂载 `ctx.mail` 的消费方。

#### KV Cache 影响

无；本包不贡献任何请求内容，因此不存在可被失效的前缀。

## 已知限制与暂缓事项

- **单收件人，无抄送／密送与附件** —— `MailMessage` 只携带一个 `to`；需要多个收件人的消费方发送多封邮件。这些字段等到有消费方需要时才出现。
- **无投递记录** —— `send` 不发出事件、不写入任何持久内容，因此必须审计发信内容的调用方自行记录。等到第一个需要落日志的消费方出现时，本 seam 再增加事件。
