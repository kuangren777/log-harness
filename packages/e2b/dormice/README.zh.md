# @deepseek-ai/dsh-dormice

[English](README.md) | 中文

[E2B 沙箱能力缝](../e2b/README.zh.md)的 Service Provider（服务提供方），由自托管的 [Dormice](https://github.com/BitMiracle-AI/Dormice) daemon 支撑。它把 [`dsh-e2b-cloud`](../e2b-cloud/README.zh.md) 的「沙箱用完即弃」假设换成「每个用户一个持久沙箱」：按 key 取用，同一个 key 永远拿回同一个沙箱且文件系统原样保留，资源释放时沙箱继续存在，交给 daemon 去冻结。部署步骤与本包所依据的、经源码核实的 daemon 事实，见所研究平台的部署方案（`ClawsGO-System/11-Deployment-Plan/01-dormice-install.md`）。

## 配置

```yaml
- id: e2b
  name: '@deepseek-ai/dsh-dormice'
  config:
    endpoint: http://127.0.0.1:3676
    userKey: !!js `sci:${process.env.DSH_SCI_USER_ID}`
    image: sci-base
    cwd: /home/user/sci
    policy:
      freezeAfterSeconds: 600
      stopAfterSeconds: 604800
    acquireTimeoutMs: 120000

- id: subprocess-e2b
  name: '@deepseek-ai/dsh-subprocess-e2b'

- id: fs-e2b
  name: '@deepseek-ai/dsh-fs-e2b'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `endpoint` | `http://127.0.0.1:3676` | daemon 的基础 URL；结尾的斜杠会被去掉 |
| `token` | `DORMICE_API_TOKEN` | daemon API token。用于原生 API 的 `Authorization: Bearer` 头，以及加上 `e2b_` 前缀后作为 SDK 的 `X-API-KEY`。绝不会转发进沙箱 |
| `userKey` | 必填 | 沙箱地址。约定形如 `sci:<userId>`；原生 API 接受任意 1–128 字符的字符串 |
| `image` | daemon 基础镜像 | 用 `dor template add` 注册过的模板；未知名称会让 daemon 直接报错 |
| `cwd` | `/home/user/sci` | 共享的远程工作目录，在适配器拿到沙箱之前创建 |
| `policy` | daemon 默认值 | 生命周期覆盖项。整个字段不填时，请求里根本不会带 `policy` |
| `policy.freezeAfterSeconds` | daemon 默认值 | active 沙箱转 frozen 前的空闲秒数 |
| `policy.stopAfterSeconds` | daemon 默认值 | frozen 沙箱转 stopped 前的空闲秒数。`null` 表示永远停在 frozen |
| `policy.archiveAfterSeconds` | daemon 默认值 | stopped 沙箱转 archived 前的空闲秒数。`null` 表示永不归档；填数字时 `stopAfterSeconds` 必须非 null |
| `acquireTimeoutMs` | `120000` | 整个取用过程（含归档恢复）的截止时间 |
| `restorePollIntervalMs` | `1000` | 归档沙箱恢复期间，两次 acquire 轮询之间的间隔 |

`policy` 的每个阈值都是对某个 daemon 默认值的单项覆盖，未填的阈值不会被发送，因此该项沿用 daemon 自己的值——原装 daemon 是 600 秒冻结、3 天停机、永不归档。合并后的结果由 daemon 校验，不可能的组合会在第一次 acquire 时收到 400。

配置错误在加载时就失败：缺 token 或 `userKey`、`endpoint` 不是 URL、`cwd` 非绝对路径、超时非正数，或者在 `stopAfterSeconds` 显式为 `null` 时还填了 `archiveAfterSeconds`。

## 取用（acquire）

`getSandbox()` 惰性取用且单飞：第一次调用执行取用，并发调用等待同一次尝试；失败的尝试不会被缓存，因此 daemon 的瞬时故障不会毒化整个服务。

一次取用是对 daemon 的两步：

1. `POST <endpoint>/acquireSandbox`，带 `Authorization: Bearer <token>` 与 `{ name: userKey, policy?, template? }`。该动词是幂等的——没有沙箱就创建、frozen 就唤醒、stopped 就重建、archived 就恢复——同名永远收敛到同一个沙箱 id。`policy` 与 `image` **只在本次 acquire 创建沙箱时生效**，但非法值仍会被拒绝。返回 `restoring` 时轮询直到 `ready` 或到达截止时间。
2. 用官方 `e2b` SDK 执行 `Sandbox.connect(id, { apiKey: 'e2b_<token>', apiUrl: <endpoint>/e2b/api, sandboxUrl: <endpoint>/e2b/envd })`，daemon 在这两个兼容前缀上提供服务。

取用走原生动词而不是兼容层的 `metadata.name` 幂等扩展，原因有二：E2B 那条路把 name 限制为 `[a-zA-Z0-9._-]{1,64}`，会拒绝 `sci:<userId>` 这样的 key；而且它会忽略请求里的 per-sandbox 生命周期策略。

`getSandbox()` 只在以下步骤完成后才返回：`cwd` 与预留的 `cwd/.dsh-e2b` 适配器状态目录都存在、预留路径被验证为真实目录而非符号链接或其他文件类型、且其 mode 被设为 `0700`。

## 资源释放

资源释放做两件事：拒绝继续获取新句柄，并中止已经在进行中的取用，因此不会有恢复轮询活得比 fiber 更久。除此之外什么都不做。它**绝不调用** `kill()`——在这个 daemon 上 kill 会销毁沙箱，把用户的整个工作区一起丢掉。沙箱保持 daemon 生命周期策略给它的状态：超过空闲阈值后冻结，下次同 key acquire 时原地唤醒。

## 模型体验

间接地，通过 `fs-e2b` 与 `subprocess-e2b` 适配器及其工具消费方——它们拥有全部呈现效果；本沙箱 provider 自身不注册任何模型可见上下文。

#### KV Cache 影响

不会直接失效；本包不会贡献请求 token。

## 已知限制与延后工作

- **没有会话事件记录取用**：`sci-audit` 目前无法区分「新建的沙箱」和「被唤醒的沙箱」，因为这个运行时所有者手上没有可供记录的 Agent 或 Session。
- **daemon 卡死时抛出的是平台的 `TimeoutError`**：只有归档恢复这条路径会用本包自己的措辞报告截止时间。
- **本包从不回收沙箱**：回收某个用户的沙箱是运维动作（`dor sandbox destroy`），因此被弃用的 key 会一直占着磁盘，直到 daemon 的归档策略或运维介入。
- **不支持跨机器放置**：`endpoint` 只指向一个 daemon，且 `Sandbox` 记录里带的是该 daemon 的 loopback 地址，因此分片集群需要一层本包没有的路由。
