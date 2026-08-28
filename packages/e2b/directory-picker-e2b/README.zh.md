# @deepseek-ai/dsh-host-directory-picker-e2b

[English](README.md) | 中文

[目录选择器能力缝](../../host/directory-picker/README.zh.md)的**沙箱浏览后端**：`E2BDirectoryPicker` 以 [`dsh-host-directory-picker-browse`](../../host/directory-picker-browse/README.zh.md) 相同的 `browse` 能力注册 `ctx.directoryPicker`，但实现针对 [E2B 沙箱能力缝](../e2b/README.zh.md)而非宿主进程文件系统。先挂载一个沙箱所有者——[`dsh-e2b-cloud`](../e2b-cloud/README.zh.md) 或 [`dsh-dormice`](../dormice/README.zh.md)——再用本后端取代 `-browse` 或 `-auto` 行，并与宿主后端所用的同一个浏览器界面 [`dsh-client-ui-directory-picker-browse`](../../client/ui-directory-picker-browse/README.zh.md) 配对：能力 kind 不变，因此客户端、RPC 消费方和线协议词汇都无需改动，唯一的差别是被列出的是哪个环境。

在文件系统与子进程能力缝都位于沙箱内的部署中，挂载本后端才能让所选的工作区目录真正可用。两个文件系统除了路径拼写之外毫无共同之处：宿主后端提供的目录（例如其进程 home）在沙箱中并不存在，而把会话 cwd 设为这样的目录会让每条沙箱命令在启动前就失败。

行为事实：`home` 就是 `ctx.e2b.cwd`——沙箱所有者在任何适配器运行前创建的共享远程工作目录——`list` 未给出路径时列出的正是它。两个原语都会拒绝非 POSIX 绝对路径；无论宿主运行在什么平台，远程环境都是 Linux，因此宿主自身的平台规则（Windows 盘符限定）对沙箱路径从不适用，Windows 形态的路径在这里只是一个相对名字。目录列表**仅返回目录**，按名称排序，并带上由宿主判定、交由客户端决定是否展示的 `hidden` 标记（点号约定）；`crumbs` 是从根到目标的祖先链，根面包屑标注为 `/`。符号链接的跟随方式是把每一跳的目标相对链接自身的父目录解析（envd 报告的是链接自己的元数据，而不是目标的），每行最多 8 跳——损坏的、成环的或链条更长的链接会被跳过，因为元数据探测本身就是可进入性的判定。单次 `list` 最多返回 `maxEntries` 行（配置项，默认 1000，与宿主后端一致），被截断的层级以 `truncated: true` 标示；层级是从沙箱文件 API 一次性完整返回的，因此该上界约束的是送往客户端的内容，且只有窗口内的候选才需要付出一次链接探测（窗口内被判定不可进入的行不会从窗口之外回填——此时该层级已被标为截断）。`createDirectory` 通过先探测父目录，在 E2B 的递归 `makeDir` 之上保持能力缝的非递归约定，因此父目录缺失是真正的失败，而不是一个可以顺手造出来的层级；它同样校验名字必须是单个非空路径段——在 Linux 名字中只有 `/` 和 NUL 属于分隔符，因此这里接受 `\`，而宿主后端会拒绝它。`list` 会把调用方的 `AbortSignal` 贯穿沙箱获取、层级请求和每次链接探测，因此断连或超时会以调用方自己的原因终止扫描。其余任何失败——层级不存在、权限被拒、沙箱不可达——都会抛出能力缝定义的 `DirectoryPickerError`，携带 `directory-unreadable`、`directory-exists` 或 `directory-create-failed`。

## 模型体验

无，因为该后端服务的是 GUI 宿主的目录选择；这里没有任何内容会进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延后工作

- **层级会在宿主侧被完整实体化**：沙箱文件 API 会以完整层级回应一次 `list`，因此 `maxEntries` 约束的是送上线协议的行数，而不是宿主在裁剪期间持有的响应；一个拥有十万子项的目录每次调用都要付出一次这样的响应。服务端窗口需要该 SDK 尚未暴露的 envd 列表上界。
- **服务端不做 `..` 规范化**：路径按客户端发送的内容使用（经 POSIX 解析后），因此通过符号链接到达的层级报告的是该路径，而不是其规范化目标。规范化会让每次导航都付出一次远程 `realpath` 进程创建，而[命令槽位上限](../fs-e2b/README.zh.md)的存在正是为了避免这一点。
- **父目录只被检查，不被持有**：`createDirectory` 先探测父目录再创建子目录，因此在这个窗口内被删除的父目录会被 E2B 的递归 `makeDir` 重新创建，而不是导致失败。目录创建没有可用的远程 no-clobber 原语。
- **作用范围是整个沙箱**：与宿主后端一致，这里没有按部署配置的浏览根限制：`workspace.create` 接受任意路径，因此在这里加一个根只是 UX 层面的收窄，而不是安全边界。
