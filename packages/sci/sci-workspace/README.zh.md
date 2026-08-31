# dsh-sci-workspace

[English](README.md) | 中文

替代 ClawsGO 的文件系统契约与 bundle skill 里的所有权禁令——它们此前只是提示词散文（归档在本仓库之外的 `ClawsGO-System/00-Architecture/02-filesystem-contract.md` 与 `ClawsGO-System/01-Skills/_raw-skills/`）。在那里，`workspace/` 是唯一交付区、`versions/` 只追加、`papers/` 不放别人的 PDF、`rm -rf` 不得触及 bundle，全都是请模型遵守的句子；真正被强制的只有「交付路径必须在 `workspace/` 内」这一条。本包把每一条都变成工具派发之前做出的决定，于是被忽略的规则变成一次带理由的拒绝，而不是一个被毁掉的 bundle。设计出处：`ClawsGO-System/09-Target-Architecture/06-delivery-and-workspace.md`（P4）与 `08-security-model.md` 第 1、12、13 行；测试 06-T1、06-T2、06-T8、08-T1。

全部判断跑在一个 `tools/pre-execute` 监听器上。`fs/write-intent` 与 `fs/edit-intent` 两个槽位刻意留给 `@deepseek-ai/dsh-fs-observation-policy`，它的「改前必读」守卫是共编安全的另一半；在工具边界上决策还让同一个监听器覆盖了 shell，而 `fs` seam 永远看不到 shell。

这是两层里的外层。内层是沙箱镜像：`papers/<slug>/` 与 `sciplots/<slug>/` 属于 render 用户，agent 自己的 uid 根本删不掉它们。shell 预检是静态 token 匹配，天生可绕过；让绕过变得没有意义的是沙箱。

## 路径表

`classifyPath(path, config)` 把路径归入十三类之一，`decideFsOp(op, cls)` 读取对应行。没有删除列：`ctx.fs` seam 没有 unlink，删除只能经由 shell 命令抵达沙箱。

| 类别 | 示例 | read | write | edit |
|---|---|---|---|---|
| `workspace` | `projects/*/workspace/**` | ✓ | ✓ | ✓ |
| `tmp` | `projects/*/tmp/**` | ✓ | ✓ | ✓ |
| `paper-src` | `projects/*/papers/*/src/**` | ✓ | ✓ | ✓ |
| `paper-manifest` | `projects/*/papers/*/*.paper` | ✓ | ✓ + manifest 门禁 | ✓ + manifest 门禁 |
| `paper-versions` | `projects/*/papers/*/versions/**` | ✓ | 仅新建 | ✗ `versions-append-only` |
| `sciplot-code` | `projects/*/sciplots/*/code/**` | ✓ | ✓ | ✓ |
| `sciplot-manifest` | `projects/*/sciplots/*/*.sciplot` | ✓ | ✓ + manifest 门禁 | ✓ + manifest 门禁 |
| `sciplot-versions` | `projects/*/sciplots/*/versions/**` | ✓ | ✗ `render-owned-versions` | ✗ |
| `references` | `papers/*/` 内 `src/`、`versions/` 之外的 `.pdf` | ✓ | ✗ `references-outside-papers` | ✗ |
| `skills` | `skills/**` | ✓ | ✗ `skills-read-only` | ✗ |
| `spool-pending` | `.sci/spool/pending/**` | ✓ | 仅新建 | ✗ `spool-create-only` |
| `private` | `.sci/**` 的其余部分 | ✓ | ✗ `sci-private` | ✗ |
| `other` | 其它一切，包括 `memory/` | ✓ | ✓ | ✓ |

读在任何区域都放行：契约限制的是 agent 能改什么，不是能看什么。读唯一可能招致的拒绝取决于它的字节，而不是它的位置。

**被委派**的会话（header `delegationDepth` ≥ 1）在查表之前先按位置设界：沙箱 home 之内、本会话自己项目之外的任何路径 —— 兄弟项目、项目根、`.claude/` 这类点目录 —— 读、写、改一律以 `delegation-scope` 拒绝，shell 命令里每个像路径的操作数（`../p2/x`、`~/.claude/...`、`cd ..`）也过同一条规则。技能树、交付 spool 和 `.sci/` 其余部分仍可达；沙箱 home 之外的路径（`/usr`、`/tmp`）交给沙箱自己的权限。被研究平台只靠 prompt 给子智能体划界，结果有一个仍把四个兄弟项目当证据引用（`clawsgo-analysis/CLAWSGO-SCHEDULING.md` §2.2）。

仅新建的写如果目标已存在，按该类别自己的规则拒绝，于是无论这次写从一开始就不被允许、还是只是来晚了一步，拒绝读起来都一样。

## 三条内容规则

**二进制读。** 读派发之前，门禁先 stat 目标；对于大小介于 8 字节与 `binaryProbeMaxBytes` 之间的普通文件，把它读回来匹配 `%PDF`、PNG、JPEG、`PK`、ELF 魔数。命中即拒绝，并点名能打开它的工具：PDF 用 `pdf` skill（`pdftotext -layout`），图片用 `sci-read-image`。探测拿不到大小或读不出来的目标一律放行，那种情况由 read 工具用它自己的措辞报告。

**manifest 所有权。** 对路径以 `.paper`、`.sciplot`、`.canvas` 结尾的写或编辑，门禁重建落盘后的文件内容——整文件写取 content 参数，编辑则把字面替换应用到当前内容——再调用 `@deepseek-ai/dsh-sci-manifest` 的 `diffOwnedFields`。结果非空即拒绝，理由里点名这些字段。既不带整文件内容参数、也不带替换对的调用（例如 `insert`）按「无法核验」拒绝，而不是猜。尚不存在的 manifest 没有共编的另一方，因此只对它做合法性检查。

**manifest 合法性。** 写会额外跑该 kind 的校验器：写替换整份文档，结果不合法就是这次调用造成的。编辑不做校验——编辑是对工作台所拥有文档的修补，因已有缺陷而拒绝会把 agent 困在一个它修不了的文件里。所有权检查两者都做，正是它挡住了用编辑偷渡整份重写、绕过校验器的路子。

**递归删除。** 对 shell 类工具，`screenShellCommand` 按 `;`、`&`、`|`、括号、换行切分命令行，处理引号与转义，寻找带递归选项的 `rm`、`git clean`、`find … -delete`。每个操作数按会话工作目录解析，落在某个项目的 `papers/` 或 `sciplots/` 目录本身或其下时拒绝。这个预检刻意过度近似：带独立取值的选项会把取值当作操作数，因为误拒的代价是重写一条命令，漏拒的代价是一个再也找不回的 bundle。

## 沙箱家目录骨架

`projectRoot` 及其下的各个区域必须先存在，这张表才有东西可判，而沙箱镜像烘不出它们：沙箱守护进程把 `/home/user` 挂成持久卷，卷一挂上就遮蔽镜像留在该路径下的一切。镜像因此把骨架副本放在家目录之外，并在 PATH 上提供幂等的 `sci-init`，而真正去跑它的就是本包——每次挂载跑一次，好让新沙箱在第一个工具调用或 workspace RPC 抵达之前就已经有 `projects/`、`memory/`、`references/`、`skills/` 和 `.sci/spool/{pending,done,failed}`。

这次执行走 `ctx.subprocess`，并且是用 `ctx.inject` 读取而不是写进本插件自己的 `inject`，因为没有 subprocess seam 这张路径表也是完整的：仅 Host 的组合保留门禁、跳过引导。命令在 `/` 里运行，因为它要创建的目录树不能是它自己的工作目录；并且没有任何东西等待它——慢的或连不上的沙箱不该拖住加载。退出码 0 会把命令自己的最后一行记到 info；非零退出、被信号杀死、spawn 抛错、以及 `bootstrapTimeoutMs` 到点，各自记一条带 stderr 尾巴的警告，门禁照旧挂着。骨架缺失于是仍然显现在真正要付代价的地方，也就是 workspace 或目录调用报出的 `not found`。

## 配置

`projectRoot` 必填且必须是绝对路径——家目录布局随沙箱镜像而不同，猜错会让所有科研区域都被归为不受管，从而悄悄关掉整个门禁。相对路径会让加载失败。沙箱家目录是它的父目录，`skillsDir`、`privateDir`、`spoolPendingDir` 都相对它解析。

`bootstrapCommand` 是那条骨架命令，按空白切分成 argv，不做任何 shell 解释；`bootstrapTimeoutMs` 是它的截止时间。命令为空即关闭引导，家目录由别处准备好的部署就该这么设。

`fsTools` 列出各类别已挂载的工具，以及门禁要从每个工具读取的参数名，因为文件系统工具集由部署选择。默认值描述本仓库自带的工具：`read`（`file_path`）、`write`（`file_path`、`content`）、`edit`（`file_path`、`old_string`、`new_string`、`replace_all`）、`str_replace_editor`（`path`、`file_text`、`old_str`、`new_str`），以及 shell 工具 `bash`（`command`）与 `terminal_send`（`text`）。一个 binding 可以把多命令工具的每个子命令映射到它实际执行的操作，`str_replace_editor view` 因此被判为读而不是编辑；未映射的子命令留在该工具声明所在的类别上，这是更严格的读法。同一个工具名出现在两个类别里会让加载失败。

## 事件

`sci/fs-denied{ op, path, rule, reason }` 记录每一次拒绝，带 envelope 的 `ignorable` 标记追加：模型已经从工具结果里知道被拒了，这条事件存在只是为了让审计投影能按会话统计拒绝数。`FS_DENIAL_RULES` 是规则词表，`./invariant` 伴随插件会拒绝任何写入词表之外规则名的拒绝事件。

## Model Experience

### 被拒的文件系统与 shell 工具调用

#### What the model sees

没有提示词章节，也没有工具 schema：放行的调用经 `next()` 委派，结果原样返回。被拒的调用返回一条错误结果，正文就是理由，而每条理由都点名一条前进的路——因为模型无法据以行动的拒绝只会变成重试循环。写入版本库读到的是 `papers/<slug>/versions/ is append-only and belongs to the LaTeX workbench: edit the sources under src/ and compile a new version instead of changing an archived one.`；读 PDF 会点名 `pdf` skill 与 `pdftotext -layout`；manifest 拒绝会引用出问题的字段名，例如 `it changes versions — the LaTeX workbench appends them`；删除 bundle 会引用它拒绝的那条解析后路径。

#### Token effect

放行的调用为零。一次拒绝用一句话替换掉工具原本的结果，比它所替代的成功负载更小，而且不会自行重试。

#### KV Cache effect

只追加：拒绝出现在原本工具结果所在的位置，可复用的请求前缀不变，已有的 KV cache 条目不会失效。

## Known Limitations and Deferred Work

- **shell 预检不是 shell 解析器** —— 命令替换、变量、同一命令行里更早的 `cd` 都不会被解释，因此一条铁了心的命令仍能抵达文件系统，只有沙箱的目录所有权能拦住它。
- **二进制探测会读完整个文件** —— `ctx.fs` seam 没有部分读（`readBytes` 对完整内容设上限，超限即失败），因此认出前 8 个字节要付一次完整读取的代价，而超过 `binaryProbeMaxBytes` 的文件根本不探测。
- **canvas manifest 不在这里校验** —— `validateCanvas` 需要知道每个节点的素材是否存在，而派发前的门禁无法在不 stat 每个节点的前提下回答；canvas 在这里只过所有权检查，完整校验由 `deliver_files` 完成。
- **拿不到当前版本就无法检查所有权** —— 目标读不出来的调用会被当作新建处理，因此门禁读不到的 manifest 靠的是沙箱权限而不是所有权 diff。
- **分类是文本层面的** —— 指向区域之外的符号链接或 bind mount 按解析后的路径文本归类，因此区域隔离最终仍然依赖沙箱而不是这张表。
- **骨架引导失败只有日志知道** —— 它在加载时运行，那时还没有任何会话，因此模型只能在之后才知道，形式是某个需要该目录的调用报出的 `not found`。
