# Agent Note：认证请求 gate

Status: implemented

[English](2026-08-23-auth-request-gate.md) | 中文

## 问题

[auth 能力](2026-08-23-auth-capability-design.zh.md)落地了用户、组与规则，却没有任何地方去查询它们。Host 依旧应答每一个通过浏览器信任围栏的请求，而那道围栏回答的是「这是否来自已声明的 authority」，不是「谁在问」。通过 tailnet 服务多个人的部署，需要一个让请求获得身份的位置，以及一种任何客户端都绕不过去的拒绝。

## 决定

### 策略表由编译器锁定

[fetch/handler.ts](../../../../packages/host/apiproxy/src/fetch/handler.ts) 中的 `METHOD_POLICY` 类型为 `{ [K in keyof RpcMethodMap]: PolicyRow<K> }`，与 `UNARY_ROUTES` 派发表并列。于是**新增一个 RPC 方法时，在有人决定谁可以调用它之前，编译就通不过**。这正是安全控制与检查清单的区别：靠纪律维护的允许列表，在有人赶时间加方法的那一刻就会漂移，而这一张不可能被遗忘，因为构建会停下来。

`PolicyRow` 进一步收窄。只有 payload 确实寻址了可归属对象的方法，才会被提供 `owner`：

```ts ignore-check
type OwnerCapable<K> = [Extract<keyof RequestPayload<K>, OwnableIdKey>] extends [never] ? never : 'owner'
```

否则，在不携带 id 的方法上声明 `owner`，会静默放行每一个已认证调用者 —— 这是最糟的一类 bug：它读起来像是在执行强制。类型让它无法被表达。

### 三个围栏点，而不是一个

围栏在 [connection/src/index.ts](../../../../packages/client/connection/src/index.ts) 中位于 `/api` 一元路由以及**两条** WebSocket 升级路径上。产品事件流是 WebSocket 而非 SSE，因此只在 fetch 路由上设卡，会让 mux 与 host 流对任何能连到端口的对端保持敞开 —— 一个看起来已认证的部署仍在泄露每个会话的完整记录。认证在三处同时施加。

### 流做过滤、列表做收窄、subagent 做拒绝

三种不同答复，各自匹配调用者所问：

- `events.mux` 会把每个会话订阅给每个客户端，因此它按归属**过滤帧**；直接拒绝连接会让合法用户的功能失效。
- `session.list`、`session.search` 与 `workspace.list` 是 `user`，并**收窄其答案**：它们本就是跨账号的提问，整体拒绝是错的。
- subagent 系列方法以 `parentSessionId` 作 `owner` 并**拒绝**。subagent 目录是某一次父对话的投影，子项自身没有归属行，因此过滤永远返回空，并悄悄弄坏该功能。

### cookie 同时携带 id 与令牌

`dsh_session` 保存 `<authSessionId>.<token>`。`authenticateToken` 只返回 `Principal`，因此若没有 id 那一半，普通的 `logout` 就只能实现为 `revokeAllSessions` —— 用户只是关掉一个标签页，却被从所有设备登出。该 id 是不可猜测的 UUID，其唯一能力就是吊销，并且**吊销从已校验的 cookie 中取出该 id，绝不从请求 payload 中取**：从参数中取，会让任何得知他人 session id 的人把对方登出。

令牌只在 `login.verify` 中签发。预登录 cookie 永不被采纳，这正是堵住会话固定（session fixation）的地方。

### 没有 auth 就是 `local`，因此什么都没变

未挂载 gate 时，`toFetchHandler` 收不到 `RequestAuthorization`，每个请求都是 `local` principal。既有部署、CLI、ACP 自动化以及每一份 keyless snapshot 的行为与之前完全一致 —— 这也正是本次改动能在不触碰任何既有预期的情况下落地的原因。授权是一个组合选择，不是一次升级。

## 考虑过的替代方案

**在客户端强制，Host 保持宽松。** 直接否决。隐藏控件只是对使用者的体贴；真正起作用的拒绝发生在操作执行的地方。这里的每条策略都在服务端，测试也直接调用派发层，完全不经过浏览器。

**手工维护一份特权方法清单。** 否决 —— 那就是已经存在的 `PRIVILEGED_METHODS`，它作为围栏层的纵深防御保留。但它不能充当授权机制，因为没有任何东西强制新方法进入其中。

**把 IP 作为审计记录的必填字段。** 否决。`req.socket?.remoteAddress` 是尽力而为的：socket 可能已不存在，而六个既有测试构造的请求替身根本没有它。限流同时以邮箱为键，因此缺少地址不会削弱任何东西。

## 后果

授权现在对每个问题各有一处归属：策略表决定谁可以调用某个方法，实现决定他们看到哪些行，而围栏仍决定哪些来源可以触达端口。针对 skill、工具、模型与设置分区的组规则强制被刻意排除在外 —— 它挂在这道 gate 之上，属于紧随其后的阶段。
