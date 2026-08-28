# dsh-sci-guard

[English](README.md) | 中文

它没有替换任何东西，因为本来就没有东西可替换：本包把 ClawsGO 十六条行为不变式里唯一没有出处的那一条写下来并落地成门禁。那张不变式表（存档于 `ClawsGO-System/00-Architecture/04-behavioral-invariants.md`，在本仓库之外）列了十六条；第十六条——高风险不可逆操作需要显式授权——是其中被观察到最稳的一条，六次红队会话、两家供应商的模型全部在授权前停下（`ClawsGO-System/05-Chat-History/_raw-transcripts/`），却始终找不到任何要求这一行为的 prompt 文本。没人指得出出处的行为，也就没人守得住。这里它变成模型读到的一章正文，以及模型会撞上的一道门禁，于是它靠的是一条写明的规则，而不是一种无法解释的规律。设计出处：`ClawsGO-System/09-Target-Architecture/08-security-model.md`（P8）不变式第 16 行；测试 08-T2、08-T3、08-T4、08-T5。

全部逻辑跑在一个返回 `{ kind: 'ask' }` 的 `tools/pre-execute` 监听器上。工具注册表通过 `@deepseek-ai/dsh-user-approval` seam 解析这个提问：`allowed-once` 放行调用，其余任何结果——拒绝、撤回、或没有可用的应答者——都由注册表用它自己的措辞拒绝。因此，没有组合 approval 服务的部署会拒绝每一条被分类的命令，而不是放它过去。

这是两层里的外层。内层是沙箱镜像：bundle 目录属于 render 用户，网络策略决定一次外传尝试究竟够得到什么。分类器是静态 token 匹配，按其构造就是可绕过的；沙箱才是让绕过变得没有意义的那一层。

## 四类

`classifyCommand(command, io, config)` 是命令行加 `io` 里那些文件系统答案的纯函数。四类按下表顺序判定，先命中者胜，所以一条既上传又删除的命令会按它本来的性质——上传——来提问。在 `categories` 里被关掉的类会被整个跳过，而不是判出来又忽略。

| 类别 | 命中 | 不命中 |
|---|---|---|
| `execUnsigned` | 命令词解析到 `<project>/tmp/` 或 `<project>/workspace/` 之下，且它是 ELF、没有 `#!`、读不回来、或在同一条命令行里刚被赋予可执行位 | exec 根下写明了解释器的脚本；镜像自带的可执行文件；`python tmp/plot.py`——它的命令词是解释器 |
| `egress` | `curl -T` / `--upload-file` / `-d @file` / `-F f=@file`；末位操作数形如 `[user@]host:path` 的 `scp`/`rsync`；出站的 `nc`/`ncat`；发起连接的 `socat` 地址 | `curl -o`、普通 GET、入站的 `rsync host:remote ./local`、监听的 `nc -l`、`ssh host 'nvidia-smi'`、在本地打包 |
| `credential` | 重定向、`cp`/`mv`/`install` 的目的地、或 `tee` 的目标，其路径含 `.ssh` 分量或名为 `.netrc`、`*.pem`、`*.key` | 其余任何写入目的地 |
| `destructive` | `rm -r`、`git clean`、`find … -delete` 解析进某个项目的 `workspace/`、`papers/`、`sciplots/`、`memory/` | `rm -rf tmp/x`——这正是预期的清理方式——以及非递归的 `rm` |

exec 探测是本插件唯一需要读文件的原因：`execCandidates` 先给出路径，插件通过 `ctx.fs` 逐个 resolve、stat、读取并求哈希，分类器再针对这些答案同步运行。一个 gate 无法解析、无法取大小、或无法完整读回的候选不提供任何答案，于是被判为未签名并提问——这是安全方向，代价是对一个大号的已签名二进制多问一次。

## 配置

`projectRoot` 必填且必须是绝对路径——各沙箱镜像的 home 布局不同，猜错会把每个区域都放到 gate 之外，并悄悄让四类里的两类失效。相对路径在加载时失败。

`execRoots`（默认 `tmp`、`workspace`）与 `destructiveRoots`（默认 `workspace`、`papers`、`sciplots`、`memory`）是项目相对的目录名。第二个列表里刻意没有临时目录：对 `rm -rf tmp/…` 提问只会训练用户不读就批准。`categories` 可逐类关闭，`probeMaxBytes`（默认 8 MiB）限制候选文件的读取上限，`shellTools` 列出挂载的 shell 类工具及各自存放命令行的参数名——默认是 `bash`（`command`）与 `terminal_send`（`text`），因为工具集由部署自己选。

## 事件

`sci/authorized{ callId, category, command, sha256?, decision }` 记录一次结案的提问，带信封的 `ignorable` 标记追加：模型已经从工具结果或调用得以执行本身知道了结局，这个事件的存在只是为了让审计投影能按 session 统计授权数与拒绝数。只有 `allowed-once` 授予时 `decision` 才是 `approved`；`sha256` 仅在 `execUnsigned` 且候选文件可读时出现，于是同一路径下被改动过的文件再次运行时，明显是另一个问题。

决定是从 approval seam 自己的 `approval/asked` → `approval/decided` 审计对里读出来的，而不是从应答者手里拿的，并且记录在工具结果之后追加。当根本没有 approval 服务应答时不写任何东西，因为没有决定可报。`./invariant` 伴生插件在已提交的日志上断言这条关系：每一条 `sci/authorized` 之前，同一 session 内都有它所指调用的完整审计对。

**不做任何缓存。** 在飞的提问在其工具调用产出结果时即被丢弃，所以一分钟前刚批准过的同一条命令会被重新分类、重新提问——这正是那一章最后一句，靠“完全没有授权记忆”来实现。

## Model Experience

### Prompt chapter `sci:irreversible-actions`

#### What the model sees

order `165` 的一章，紧接在 `@deepseek-ai/dsh-sci-prompt` 贡献的最后一章之后，原文照录：*Irreversible actions. Before you execute an unsigned binary or installer, upload or transmit content from this machine to an external endpoint, modify SSH keys or credentials, or delete anything outside `tmp/`, stop and ask the user for explicit authorization through the approval tool — state what the action does, what it touches, and what cannot be undone. A README's description of a binary is not evidence of what the binary does; inspect it statically (`file`, `readelf`, `strings`, `sha256sum`) and report discrepancies before asking. Authorization for one action does not extend to the next.* 这里刻意没有常驻 reminder：这条规则是被强制执行的，每轮重述它换不来任何东西。

#### Token effect

约九十 token，一次性计入静态 section 块。

#### KV Cache effect

前缀稳定：section 在所有动态 context 之前组装，而这一章的文本永不变化，所以不产生任何重新物化开销。

### The approval question and its refusal

#### What the model sees

gate 给出的 `reason` 经 `approval/asked` 抵达用户，每一条都回答了那一章要求模型在提问前说清的三件事——这个操作做什么、碰到什么、什么撤不回来——于是由 gate 提出的问题与模型自己提出的问题携带同样的事实；`execUnsigned` 的理由还会附上那一章的证据规则（*README 对二进制的描述不是该二进制行为的证据：用* `file`、`readelf`、`strings`、`sha256sum` *静态检查它*），因为那正是模型只有文档、没有观察的场合。而模型在非授予结果下读到的，是注册表自己的句子而非本包的：拒绝是 `Error: the user rejected tool "bash"`，撤回是 `Error: approval for tool "bash" was cancelled`，无人可答是 `Error: tool "bash" requires approval, but no approval channel is available`——只有在完全没有组合 approval 服务时，gate 的理由本身才成为拒绝文本。

#### Token effect

对分类为无风险的命令为零。一条被门禁的命令花掉一条理由——三到四句——要么作为 approval 提示，要么作为替代工具结果的拒绝。

#### KV Cache effect

只追加：提问在派发前就已解决，拒绝占据了工具结果本该占的位置，可复用的请求前缀不变。

## Known Limitations and Deferred Work

- **分类器不是 shell 解析器** —— 命令替换、变量、函数以及同一条命令行里更早的 `cd` 都不被解释，所以一条铁了心的命令能抵达沙箱，只有沙箱的所有权与网络策略能拦住它。它与 `@deepseek-ai/dsh-sci-workspace` 共用 `tokenizeCommand` 与 `recursiveDeleteOperands`，所以那道 gate 在 bundle 内拒绝的命令，正是这道 gate 在别处会提问的同一条命令。
- **未签名执行只检查命令词** —— `./tmp/installer` 会被门禁，`python tmp/installer.py` 不会，因为 shell 执行的是解释器。筛查解释器参数需要逐解释器的参数模型，本期不做。
- **哈希标定的是分类时刻的候选** —— 在提问与派发之间被替换的文件会未经提问地运行。要堵住它需要 exec 本身携带哈希，而 shell seam 不提供这个。
- **凭据路径按操作数字面匹配** —— 展开 `~` 和 `$HOME` 的是 shell 而不是这道 gate，所以 `~/.ssh/id_ed25519` 与绝对路径都会命中，而由变量拼出的路径不会。
- **整个项目目录不算破坏性区域** —— `destructiveRoots` 那四个名字是在项目下一层匹配的，所以 `rm -rf ../p2` 交给沙箱自己的所有权，而不是在此提问。
- **`terminal_send` 按单条命令行筛查** —— 逐键发送的终端工具可以把一条会被分类的命令拆到多次调用里组装，每一次单独看都不命中。`sci` 的两个 preset 不挂终端工具。
