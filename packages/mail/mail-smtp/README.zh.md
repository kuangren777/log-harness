# dsh-mail-smtp

[English](README.md) | 中文

SMTP [邮件](../mail/README.zh.md)提供方，基于 [nodemailer](https://nodemailer.com)。组合文件只携带端点与凭据的**名字**；值留在[凭据](../../credentials/credentials/README.zh.md) seam 中。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `host` | 必填 | SMTP 服务器主机名。 |
| `port` | 必填 | SMTP 服务器端口。 |
| `secure` | 必填 | `true` 表示连接直接以 TLS 起始（隐式 TLS，通常为 465 端口）；`false` 表示在服务器支持时用 STARTTLS 升级。 |
| `from` | 必填 | 每封邮件使用的 `From` 地址。 |
| `userRef` | 缺省 | 持有 SMTP 用户名的凭据引用名。 |
| `passwordRef` | 缺省 | 持有 SMTP 密码的凭据引用名。 |

```yaml
- @deepseek-ai/dsh-mail-smtp:
    host: smtp.example.com
    port: 587
    secure: false
    from: Harness <no-reply@example.com>
    userRef: DSH_SMTP_USER
    passwordRef: DSH_SMTP_PASSWORD
```

`userRef` 与 `passwordRef` 是引用**名**而非密钥：组合文件里写的就是 `DSH_SMTP_PASSWORD`，它背后的值存放在挂载的凭据提供方所在之处。接受未认证投递的中继两者都省略；只配置其中一个会在加载时失败，因为 SMTP AUTH 需要两半齐备。

## 凭据解析

两个引用在**每一次**发送时都经 `ctx.credentials` 解析，这正是轮换后的密码无需重启 harness 就能作用于下一封邮件的原因。两类失败都会明确报错并指名引用，且绝不打印它的值：

- 引用解析不到任何值——`mail-smtp: credential reference "DSH_SMTP_PASSWORD" is not configured; store it through the credentials service`；
- 根本没有挂载凭据服务，而这不可能是一个已配置引用的组合的本意。

不符合凭据语法的引用会更早失败：`resolveSpec` 在加载时为它加品牌标记，此时正在被读取的恰是携带该笔误的组合文件。

## 连接复用

只要解析出的登录信息不变，一个传输通道——也就是一个 nodemailer 连接池——服务所有发送。轮换会产生不同的登录信息，于是先关闭已开的传输通道，再打开下一个，因此被撤销的密码绝不会继续维持一条已认证的活连接。`ctx.effect` 把活跃传输通道绑定到所属 fiber；释放资源时关闭它并拒绝之后的发送，第二次释放则无事可做。

提供方为每个打开的传输通道记录一行 debug 日志，写出主机、端口以及它据以认证的**引用名**。解析后的用户名与密码绝不会被记录。

## 为什么用 nodemailer

SMTP 帧、STARTTLS 协商、AUTH 机制选择、`text`／`html` 替代正文的 MIME 组装以及首部编码，是本仓库否则就要完全自持的一整套协议实现，还要连同让它对真实服务器保持正确的测试一起维护。nodemailer 有人维护、采用 MIT-0 许可、且没有运行时依赖，因此这次删减不增加任何供应链面（[依赖策略](../../../.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.zh.md)）。提供方只依赖它的两个操作，声明为 `MailTransport` 接口，这也正是套件能在没有 SMTP 服务器的情况下驱动提供方的原因。

## 模型体验

无：本提供方投递的是面向运维者的邮件，邮件内容、凭据与投递错误都留在宿主侧，随产品发布的组合中也没有挂载它。

#### KV Cache 影响

无；本包不贡献任何请求内容，因此不存在可被失效的前缀。

## 已知限制与暂缓事项

- **无投递重试** —— `sendMail` 被拒绝时 `send` 即 reject；是否重试由调用方决定。这里不区分临时性 4xx 与永久性 5xx。
- **仅支持密码 AUTH** —— 两个引用刻画的是用户名／密码登录。OAuth2 的 SMTP token 需要另一条解析路径（凭据记录，并且要刷新），目前还没有消费方提出该需求。
- **无连接池大小与超时配置** —— 沿用 nodemailer 的默认值；等到有部署需要时，这些连接旋钮再成为 `Config` 字段。
