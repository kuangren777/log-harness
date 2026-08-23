# Agent Note：认证与授权能力 seam

Status: implemented

[English](2026-08-23-auth-capability-design.md) | 中文

## 问题

Host 只服务一个被隐式信任的操作者。浏览器信任围栏（[api-request-trust](../../../../packages/client/connection/src/api-request-trust.ts)）回答的是「这个请求是否来自已声明的 authority」，它防御 DNS 重绑定与跨站调用，却完全不回答「是谁在问」。于是，通过 tailnet 服务多个人的部署没有任何办法阻止一个人进入另一个人的会话，也无法决定某个组不能看到某个 skill。`packages/client/connection/src/index.ts` 里本就写着配置平面「在真正的认证出现之前保持 loopback-same-origin」；本次就是那个认证。

## 决定

seam 由两个包构成。`dsh-auth` 持有词汇与原语，`dsh-auth-sqlite` 持有记录。两者都不会把自己挂进出厂组合，因此该能力是可选的，所有既有部署与 keyless snapshot 都不受影响。

### `local` principal 让认证保持可选

`Principal` 要么是用户，要么是 `{ kind: 'local' }`，而 `local` 拥有全部权限。CLI、ACP 自动化、进程内测试，以及任何没有 auth 提供方的组合，都以 `local` 身份说话，因此把该包族加入仓库没有改变任何既有行为。只有当部署挂载了提供方、且 gate 解析出一个真实用户时，授权才开始生效。

### deny 压过 allow，未提及即拒绝

`evaluate` 以 **deny > allow > 默认拒绝** 的优先级针对组规则解析一个名字。默认拒绝是承重的那一半：没有任何规则提到的 skill、工具、模型或设置分区，在受限组眼中不可见。这样，之后新增的能力在落地那一刻就是安全的，而不是在有人想起来去禁止之前一直暴露着。`permits` 在其上叠加 principal，对 `local` 与 `admin` 短路放行。

规则是扁平的，并在用户的各个组之间取并集。排序与优先级被否决：在 deny 优先的前提下，两条规则之间的先后已经确定，而一个有序列表只会让某个组的规则悄悄削弱另一个组的规则。但位置本身是持久的，因为管理页面要按这个顺序重新展示：`setRules` 把每条规则的下标写入 `rules.ordinal` 列，`listRules` 按它读取，于是一个组回来时保持保存时的顺序，而不是存储引擎觉得最省事的顺序。这是展示，不是优先级 —— `evaluate` 从不读取规则的位置，规则次序被打乱的组对每个名字的判定完全一致。

### 选 scrypt，不选 argon2id

密码散列使用 node:crypto 的 scrypt（N=2^15、r=8、p=1）。纸面上 argon2id 更强，但 Node 上的每个实现都是原生插件：供应链里多一个需要编译的依赖，在本就有 Windows lane 的仓库里多一份逐平台重建，以及对这个绝不能出错的包多一份审计负担。scrypt 是内存硬的、内置的，并且被认可用于密码存储。其编码形式自带参数，因此日后提高成本不会让已存储的散列失效。

### 只有摘要进入存储

auth session 令牌与一次性验证码只生成一次、返回一次，并且只以 SHA-256 摘要存储；查找按摘要进行，确认使用 `timingSafeEqual`。被窃取的 `auth.db` 副本给不出任何可重放的东西。审计日志遵循同一规则，不记录任何凭据material。

### 归属存在 auth.db，而不是会话日志

`session_owners` 与 `workspace_owners` 在 auth 数据库内把资源映射到创建者。把归属放进 `SessionHeader` 本是更直观的位置，但那会抬升 `SESSION_FORMAT_VERSION`，让每一份既有会话日志对于「知道用户」的构建不可读 —— 对一个 agent loop 从不读取的事实来说，这个爆炸半径太大。把归属放在它所引用的用户旁边，也意味着删除 auth 数据库就能干净地移除整个多用户层。

### 限流是持久的，且不是配置

密码、2FA 发送与重置窗口保存在 `rate_events` 表中，因此锁定会跨重启存活，而不是被一次重启清空。这些限额是固定常量：能自行放宽暴力破解窗口的部署，得到的不是一个旋钮，而是一条关闭安全控制的途径。

## 考虑过的替代方案

**复用 `packages/identity` 作为 principal。** 否决。那个包是 `dsh-anonymous-user-id`，一个用于遥测与 DeepSeek 关联头的按 home 随机 UUID，其文档明确说明它从不派生自任何可识别来源。把它当作凭据会破坏该承诺，并让每个未认证进程都拥有一个看起来权威的身份。

**用 `permission-presets` 表达权限。** 否决。preset 把 `sandbox/mode` 与 `approval/policy` 打包，并在会话创建时固定：它回答的是一个运行中的会话能做多少，而不是调用者是谁。把授权折叠进去，会把一个安全决策绑在会话作用域的 UX 控件上。

**版本漂移时迁移 schema。** 否决。`AUTH_SCHEMA_VERSION` 只拒绝、不迁移，与仓库的预发布立场一致；悄悄地以错误方式解释另一个构建写入的凭据行，是比拒绝启动更糟的失败。为 `rules` 增加 `ordinal` 列的版本 2 是该策略的第一次实际执行：已有的 `auth.db` 是重建，而不是升级。

## 后果

仓库新增 `auth/` 包族，挂载它的部署会在 `$DSH_HOME/auth.db` 得到一个 SQLite 数据库。执行（enforcement）不属于本 note：按请求解析 principal 的 gate，以及覆盖 skill、工具、模型、设置与会话归属的组过滤器，随后续阶段落地。在那之前这两个包是惰性的 —— 这也正是它们能在不触碰任何既有测试的情况下落地的原因。
