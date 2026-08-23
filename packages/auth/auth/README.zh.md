# dsh-auth

[English](README.md) | 中文

[认证与授权](../README.zh.md)能力 seam 的 Service Definition：一个请求代表谁、其所属组允许什么，以及让密码与一次性凭据在静态存储中不可逆的原语。

## Principal

```ts ignore-check
type Principal =
  | { kind: 'user'; userId: UserId; email: string; groups: readonly GroupId[]; admin: boolean }
  | { kind: 'local' }
```

`local` 是进程内 principal：CLI、ACP 自动化、测试，以及任何未挂载 auth 提供方的组合。它拥有全部权限，因此不挂载认证的部署与本包出现之前的行为完全一致。授权由此成为可选的组合项，绝不是一次静默的行为变更。

## 权限规则

```ts ignore-check
type PermissionDomain = 'skill' | 'tool' | 'model' | 'settings-section'
interface PermissionRule { domain: PermissionDomain; pattern: string; effect: 'allow' | 'deny' }

function evaluate(rules: readonly PermissionRule[], domain: PermissionDomain, name: string): boolean
function permits(principal: Principal, rules: readonly PermissionRule[], domain: PermissionDomain, name: string): boolean
```

优先级为 **deny > allow > 默认拒绝**：命中的 `deny` 直接定论，命中的 `allow` 放行，没有任何规则提到的名字一律拒绝。`pattern` 是精确名称或结尾 `*` 的前缀通配；`model` 的 pattern 写作 `provider/model`。`permits` 额外接入 principal：`local` 与 `admin: true` 跳过求值，其余 principal 则以其所有组规则的并集走 `evaluate`。

默认拒绝正是让新能力天然安全的原因：没有规则提到的 skill、工具、模型或设置分区，在受限组眼中不可见，直到有人显式授予。

## 密码与令牌原语

`hashPassword` / `verifyPassword` 使用 node:crypto 的 **scrypt**（N=2^15、r=8、p=1、32 字节随机 salt、32 字节 hash），编码为 `scrypt$N$r$p$b64salt$b64hash`，并以 `timingSafeEqual` 比较。scrypt 是 Node 内置，因此部署得到一个内存硬 KDF，而无需审计或重新构建任何原生依赖。明文密码绝不被存储、返回或写日志。

`mintToken` 返回 256 位 base64url 令牌及其 SHA-256 摘要；`mintCode` 返回 6 位数字码、逐码 salt 与 `digestOfCode(salt, code)`。**只有摘要允许进入存储** —— 令牌或验证码的明文形态只存在一次，即承载它的响应或邮件之中。`sameDigest` 以常量时间比较。

## 服务 API

`ctx.auth` 上的 `AuthService` 声明提供方需实现的操作：用户与密码记录、登录校验、auth session 的签发与吊销、用于 2FA / 邮箱验证 / 密码重置的一次性令牌、组与成员及规则管理、会话与工作区归属，以及审计的追加与读取。每个成员的契约都记录在该声明处；[dsh-auth-sqlite](../auth-sqlite/README.zh.md) 是被挂载的实现。

## 模型体验

无。该 seam 决定谁可以调用 Host，从不参与模型请求：principal、规则、密码、令牌与审计记录都不会进入 prompt、工具 schema 或工具结果。

#### KV Cache 影响

无；本包不贡献任何请求内容，因此不会使任何前缀失效。

## 已知限制与后续工作

- **规则按组扁平生效** —— principal 的有效规则是其所有组规则的并集，deny 优先。没有规则排序、优先级或按用户覆盖；需要不同答案的用户应加入不同的组。
- **pattern 仅支持精确或前缀通配** —— 不支持正则或字符类。只有当某个部署给出无法表达的规则时，这套词汇才会扩展。
- **除长度外没有密码策略** —— 组成复杂度、轮换、历史复用与泄露库比对属于创建用户的那个界面；本 seam 只拒绝以可逆方式存储密码。
