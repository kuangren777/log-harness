# 多用户 Web

[English](README.md) | 中文

这个 overlay 让单个 `dsh web` 进程选择启用[认证](../../packages/auth/README.zh.md)，而已发布的默认 Web 组合保持单租户不变：

```sh
dsh auth bootstrap --email you@example.test
dsh web --patch examples/web-auth/cordis.yml
```

bootstrap 命令排在前面，且只运行一次。它在 `$DSH_HOME/auth.db` 中创建第一个管理员账户，而 overlay 正是把 provider 指向同一个数据库；若在空数据库上叠加 overlay，则没有人能登录，任何请求都不会被服务。

它挂载三行，三行缺一不可。`dsh-auth-sqlite` 保存账户、组、规则、会话、一次性凭据与审计日志。mail provider 投递登录验证码以及确认与重置链接。[`dsh-auth-gate`](../../packages/auth/auth-gate/README.zh.md) 提供 `/auth` 通道，并回答传输层对每个请求提出的问题。挂载了 provider 却没有 gate 的组合意图认证却无法认证，因此 host 宁可完全停止服务，也不会把每个调用方都当作匿名者来服务。

叠加这个 overlay，正是应用前面出现登录界面的原因。已发布的 Web 组合本就带着 [`dsh-client-ui-auth`](../../packages/client/ui-auth/README.zh.md)，在没有任何东西服务门的 `/auth` 通道时它保持不可见；overlay 生效后，浏览器打开的是登录卡片而不是会话，侧边栏底部也多出一行账号，带**退出登录**与**退出全部设备**。

登录分两步：先密码，再是邮件送达的六位验证码。浏览器随后持有一个 `HttpOnly; SameSite=Strict` 的会话 cookie，每个 `/api` 请求与事件流升级都据它认证。已认证的调用方接下来能触达什么，由[网关的策略表](../../packages/host/apiproxy/README.zh.md)决定，而不是这个 overlay。

## 管理其余账号

第一个管理员在浏览器里管理其余所有人。**设置 → 访问控制**由 [`dsh-client-ui-settings-access`](../../packages/client/ui-settings-access/README.zh.md) 贡献，列出全部账号与全部权限组，创建与停用账号，创建、重命名与删除组，在组之间调整成员，并编辑每个组所带的规则。这个分区对所有人存在，对门未认定为管理员的人只渲染一段说明；隐藏它只是体贴，真正起作用的拒绝来自网关——它对非管理员拒绝全部九个 `auth.admin.*` 方法。

规则是部署最容易把自己坑住的地方。没有任何规则涉及的域是完全开放的，而第一条涉及它的规则会把整个域变成白名单——于是单独一条 `deny secret-skill` 拒绝的是该组的全部技能，而不是一个。访问控制页会在某个域的第一条拒绝旁补上一条 `allow *`，在某个域一个名称也不允许时点名警告，并在保存之前按组成员的视角预览真实的技能清单。

门发出的重置与确认链接以 `baseUrl` 为基准解析，并落回同一个应用，因此该值必须指向浏览器实际访问的 origin。

## 在其他人登录之前

`mail-file` 把邮箱写到 `$DSH_HOME/mailbox.jsonl`，每条消息一行 JSON。它是可用的本地试运行，同时对任何能读该文件的人都是第二因子的绕过口，因此账户多于一个的部署应换成 `@deepseek-ai/dsh-mail-smtp`。

overlay 里写 `cookieSecure: false`，是因为默认 `baseUrl` 是 loopback HTTP，那里带 `Secure` 的 cookie 根本不会被发送。它只在 loopback、或在 origin 从公网不可达的加密 tailnet 内部才成立。其他任何部署都应把 `baseUrl` 设为自己的 HTTPS origin 并删掉这一行，恢复 `true` 默认值。

覆盖层的预设表里刻意没有 `danger-full-access`。这个部署由多人共用，任何会话都不应越出自己的工作区；这里是把该条目**移除**，而不是仅仅改掉默认值——默认值是会话可以再切回来的东西。约束能否成立取决于宿主：`workspace-write` 需要 bubblewrap 或启用 Landlock 的内核，没有它 shell 会拒绝运行而不是无约束地运行——这是安全的失败方式，但在会话中途遇到会让人意外。若 `$DSH_HOME/settings.yaml` 中已有指向被移除预设的 `permission.defaultPreset`，必须清掉，否则它引用的预设已不在表中。

`baseUrl` 必须与浏览器实际访问的 origin 一致，端口也要一致：邮件中每个链接都以它为基准解析。
