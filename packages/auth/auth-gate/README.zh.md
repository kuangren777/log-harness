# dsh-auth-gate

[English](README.md) | 中文

[认证与授权](../README.zh.md) seam 的 Consumer：把 [`AuthService`](../auth/README.zh.md) 变成浏览器可用之物的插件。它提供 `/auth` 登录通道，并提供 `ctx.authGate`——HTTP 传输在放行任何请求之前都会问它。

它只判定请求是谁，绝不判定请求能做什么。允许哪些操作由网关的[策略表](../../host/apiproxy/README.zh.md)决定；本包只回答第一个问题，以及浏览器如何拿到这个答案。

插件注入 `auth`、`connection`、`mail`，三者都没有回退。缺少 mail provider 的组合无法投递第二因子，那样只能靠削弱流程才能让人登录，因此插件宁可保持未激活。

| `Config` 字段 | 含义 |
|---|---|
| `baseUrl` | 邮件中每个链接所解析的绝对 origin。没有默认值：指向错误 origin 的链接要么打不开，要么把一次性令牌送到别处。 |
| `cookieName` | 会话 cookie 名，默认 `dsh_session`。 |
| `cookieSecure` | cookie 是否带 `Secure`，默认 `true`。 |
| `codeTtlMs` | 第二因子验证码有效期，默认 10 分钟。 |
| `linkTtlMs` | 重置与确认链接有效期，默认 1 小时。 |

## 三道栅栏，三种粒度

**放行**，位于 [`dsh-client-connection`](../../client/connection/README.zh.md)。每个 `/api` 请求与每次事件流升级在被服务之前都先解析出 principal。三种结果：既无 auth provider 也无 gate 时放行 `local`，这正是让单租户部署行为与本包出现之前完全一致的原因；gate 认证通过凭据则放行该用户；而挂载了 provider 却**没有** gate 时，host 干脆停止服务——这样的组合意图认证却无法认证。拒绝时会清除 cookie，浏览器便不再重复发送这台 host 永远不会再接受的凭据。

**方法策略**，位于网关的 `METHOD_POLICY`。每个 RPC 方法是 `user`、`admin` 或 `owner`。

**帧可见性**，位于网关的流过滤器。两条服务端到浏览器的流都订阅 host 上的每个会话，因此无法靠拒绝连接来保证安全；每一帧改为在发出的路上被丢弃或收窄。

## 策略表为何由编译器锁定

`METHOD_POLICY` 的类型是 `{ [K in keyof RpcMethodMap]: PolicyRow<K> }`，因此新方法在被赋予策略之前无法通过编译，而且就在与其路由行相同的文件、相同的一次改动里。`owner` 行还必须指明可据以解析归属的 payload 键，这正是让这些行可被检查而非徒具形式的原因。默认值在这里恰恰是危险形态：被人遗漏的那个方法，正是绝不能悄悄变得可达的那个。

`subagent.list` 是基于 `parentSessionId` 的 `owner`，做法是拒绝，而不是返回过滤后的目录。subagent 目录是某一段父对话的投影，子代自身不携带归属记录，因此拥有父会话就是问题的全部——没有留下任何可供逐条过滤的事实。

## cookie

凭据是 `<authSessionId>.<token>`，在第一个分隔符处切分，带 `HttpOnly; SameSite=Strict; Path=/`。`SameSite=Strict` 就是那道跨站栅栏，它使网关那些会改变状态的方法无需 CSRF 令牌也安全。

id 那一半可以安全携带。seam 能把令牌解析为 principal，却不提供由令牌反查会话的方法，因此没有 id，登出就只能撤销该账户的全部会话。出示 id 本身不认证任何东西，它唯一能指名的操作，是撤销一个调用方本就持有其 id 的会话。

即便如此，撤销也从不把它当作输入信任。`logout` 从请求已通过认证的那个 cookie 推导出会话 id，任何端点都不接受 payload 里的会话 id，因此一个账户无法把另一个账户登出。

## 一律模糊的失败

没有任何端点会区分未知地址与错误密码、过期验证码与错误验证码、已消费链接与伪造链接。无论地址是否有对应账户，`password.forgot` 都给出同一句确认，并把 provider 的限流拒绝一并吞进这同一个回答里而不上报——可区分的拒绝会确认该地址存在。失败唯一可以携带的事实是锁定截止时间，而它是按提交的地址计数的，无论该地址是否指向一个账户。

bearer 令牌只在一个地方铸造，即 `login.verify`，因此调用方已持有的 cookie 永远无法被升级为已认证的 cookie。兑换 `verify-email` 链接就是记录确认本身：provider 在消费该凭据的同一个事务里写入它，因此 gate 没有第二次可能落空的写入。

## 模型体验

无。该 gate 认证 Host 请求并投递登录邮件：principal、cookie 与邮件正文都不会进入模型请求，本包也不注册工具、prompt 分区或会话事件。

#### KV Cache 影响

无；本包不贡献任何请求内容，因此不会使任何前缀失效。

## 已知限制与后续工作

- **无自助注册** —— 账户由 `dsh auth bootstrap` 或某个管理界面创建；本通道只服务登录、登出、重置与确认。
- **组变更通知需要调用方** —— `notifyAddedToGroup` 拥有模板却不拥有触发时机，因为 seam 不发布成员变更事件；改动成员的那个界面必须自己调用它。
- **仅限可选组合** —— 没有任何已发布 profile 挂载本插件。分层方式见 [`examples/web-auth/`](../../../examples/web-auth/README.zh.md)。
