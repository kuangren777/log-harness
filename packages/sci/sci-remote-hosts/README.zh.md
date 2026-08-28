# sci-remote-hosts —— `sci` profile 的 `~/.ssh/config` 托管块

[English](README.md) | 中文

对应原平台的 *Agent 对话框 → SSH* 表单及其喂养的 `clawsgo-remote-hosts` skill（`ClawsGO-System/01-Skills/_raw-skills/clawsgo-remote-hosts/SKILL.md`，方案见 `ClawsGO-System/09-Target-Architecture/07-skills-plan.md`）。两处变化。原平台每次保存都重写整个文件，于是 skill 只能反过来教用户：标记内手改的内容会被归一化吞掉，自己的 `ProxyJump` 链请写到别处；这里保证是双向的——标记内以插件为准，标记外每一个字节原样保留。私钥则改走 `ctx.credentials` 能力缝，不再只是「一堆没有归属的文件」，于是「这个沙箱被授权去连哪些机器」变成一条带 scope 的记录，而不是一份目录清单。

## 配置

```yaml
- name: '@deepseek-ai/dsh-sci-remote-hosts'
  config:
    sshConfigPath: /home/user/.ssh/config
    identityDir: /home/user/.ssh
    connectTimeoutSeconds: 10
    serverAliveIntervalSeconds: 30
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `sshConfigPath` | 必填 | 沙箱内 ssh 客户端配置文件的绝对路径 |
| `identityDir` | 必填 | 逐 alias 私钥写入的绝对目录 |
| `connectTimeoutSeconds` | `10` | 每条渲染条目的 `ConnectTimeout` |
| `serverAliveIntervalSeconds` | `30` | 每条渲染条目的 `ServerAliveInterval` |

两个路径都必填且没有默认值：家目录布局随沙箱镜像而异，猜错就会把托管块写到没有任何 `ssh` 调用会读的地方。相对路径在加载时即失败。

## 托管块

```
# >>> sci remote hosts >>>
Host gpu-lab
    HostName gpu.example.com
    User ubuntu
    IdentityFile /home/user/.ssh/sci-gpu-lab
    IdentitiesOnly yes
    BatchMode yes
    ConnectTimeout 10
    ServerAliveInterval 30
    StrictHostKeyChecking accept-new
# <<< sci remote hosts <<<
```

这组选项就是 skill 对模型作出的承诺——非交互 `BatchMode`、不弹主机密钥确认、10 秒连接超时、保活——好让模型永远不必自己加 `-o`。`IdentitiesOnly` 是让这份承诺站得住的一条：没有它，ssh 会先把 agent 里的每一把身份都递出去，可能在轮到本条目自己的密钥之前就耗光服务端的 `MaxAuthTries`，于是一台好机器看起来像是授权失败。`Port` 只对声明了端口的条目渲染：skill 给「机器不可达」开的药方就是端口转发，而转发出来的实验室机器很少还答在 22。

`renderManagedBlock(hosts, options)` 按 alias 顺序输出条目，因此重新注册一份没有变化的名单会产出完全相同的字节。被用户关掉的主机保留条目、逐行注释掉，而不是删除——这正是 skill 告诉模型「不要用、也不要取消注释」的那个状态。

`spliceManagedBlock(existing, block)` 只替换两个标记之间的区域，其余原样透传。唯一的例外是最后一行没有换行的文件：追加托管块之前会先把那行补上换行，否则用户的最后一条条目会和起始标记连成一行。只有一个标记而没有另一个的文件会被拒绝而不是「修好」——区域的边界未知时，重写要么复制出第二个块，要么吞掉它下面的全部条目。

## 注册

`sci.hosts.list` / `upsert` / `remove` / `toggle` 是 `sci.hosts` 命名空间下的 Typert Remote 端点。配置文件是唯一状态：`list` 直接把托管块解析回来，而不是查缓存，因此 RPC 报出的名单和 `ssh` 真正能连到的主机是同一个事实。

`upsert` 按托管顺序提交——先写凭据记录，再写条目将要指向的密钥文件，最后才写条目——因此中断最坏留下一把没人引用的密钥，绝不会留下一条指向从未写入的密钥的条目。`remove` 反过来：先删条目，再把密钥文件覆写为空，最后删除记录。

alias 必须匹配 `^[a-z][a-z0-9-]*$`，也就是凭据缝自己的 key 段文法；`hostName` 与 `user` 各自必须是一个不含空白的 token。后一条是 wire 边界校验而非洁癖：带换行的值会把额外的选项行写进托管块，而这个块正是「模型可以连到哪里」的读取来源。

密钥材料只到达凭据缝和密钥文件两处。它从不写入配置文件，从不由任何端点返回（`list` 只报出条目使用的密钥路径），也从不追加进 session log。

## 失败诊断

`classifySshFailure(verboseOutput)` 把一份 `ssh -v` 输出判成一个排序过的原因加一句处置建议，并作为 `sci-ssh-doctor <alias>` 命令随沙箱镜像安装。skill 早就知道这个排序——公钥不在服务端该用户的 `authorized_keys` 里、机器在本沙箱网络里不可达、用户名不对——但把「读 `ssh -v`」这件事留给了一个从没见过那台服务器的模型。

| 原因 | 判据 |
|---|---|
| `host-unreachable` | 连接被拒、超时、无路由，或名字解析不出来 |
| `key-unusable` | ssh 拒绝密钥文件本身：不存在、读不了，或权限宽于 `0600` |
| `wrong-username` | 服务端明说这个账号无效或不被允许 |
| `key-not-authorized` | 递出密钥之后仍是 `Permission denied (publickey)` |
| `unclassified` | 输出里没有任何有结论的证据 |

规则按上表顺序判定，依据是证据有多确凿而不是原因有多常见：根本没连上服务器的连接不可能是认证失败，被 ssh 拒绝加载的密钥根本没被递出去，所以这两条都在那行「所有这些失败都会打印」的 `Permission denied (publickey)` 之前判完。`key-unusable` 之所以从 skill 的三个原因里单列出来，是因为同一份 skill 也写着私钥必须 `chmod 600`、否则 ssh 拒收——把它报成「`authorized_keys` 里缺公钥」会把用户支去修一台其实没问题的服务器。

## 模型体验

间接地，通过模型在沙箱里执行的 `ssh` 与 `rsync` 命令行以及教它们的那份 skill；本包自身不注册任何提示词、工具或模型可见上下文。

#### KV Cache 影响

无。本包写出的任何东西都不会进入模型请求：托管块是沙箱里的 `ssh` 读的，不是提示词装配读的，因此它拥有的前缀不会移动，注册、开关或移除主机也不会让任何已缓存前缀失效。

## 已知限制与延后工作

- **密钥文件的权限位归沙箱镜像管**：`ctx.fs` 没有 `chmod` 动作，本包只能按后端选定的权限写出密钥。ssh 会拒收同组或全局可读的私钥，所以镜像必须让 `identityDir` 下新建的文件落到 `0600`——否则每台主机第一次使用都会以 `key-unusable` 失败。
- **移除时密钥是被清空而非删除**：`ctx.fs` 同样没有 unlink 动作。移除会把文件覆写为空，材料确实销毁了，但会留下一个零字节的 `sci-<alias>`。
- **没有会话事件记录注册动作**：这个 RPC 是一次配置行为，背后既没有 session 也没有 Agent，因此 `sci-audit` 无法展示某台主机是何时变得可达的；事件也没有可归属的 session。
- **生成的 Remote 客户端尚未注册**：`pnpm run build` 会从 `./typert` 与 `./remote` 导出生成 `lib/typert.host.*` 和 `lib/typert.remote-client.*`，但把本包加进 `packages/api/remotes/src/client/index.ts` 属于 profile 装配拥有的跨包改动。
- **`sci-ssh-doctor` 是一个 Node 命令**：沙箱自己的 `sci` CLI 是 Python 移植，在它按同一组 fixture 把 `classifySshFailure` 移植过去之前，没有 Node 的镜像只能通过本包的 bin 拿到这个分类器。
