# sci/ — 科研智能体产品层

[English](README.md) | 中文

`sci` 产品层：把一个研究过的、纯靠 prompt 约束的科研智能体平台（存档在仓库外的 `ClawsGO-System/`）复刻到 dsh 的类型化扩展点上。原平台通过服务端拼 prompt 施加的每条规则，在这里落成 prompt section、`tools/pre-execute` 门禁、session 事件或沙箱权限。设计与包合同：`ClawsGO-System/09-Target-Architecture/`。

| 包 | 角色 | ctx key / 表面 |
|---|---|---|
| [`sci-prompt/`](sci-prompt/README.zh.md) | 八个 prompt 章节与四条常驻 reminder，带 reminder→章节不变式。 | `ctx.systemPrompt` |
| [`sci-manifest/`](sci-manifest/README.zh.md) | `.paper` / `.sciplot` / `.canvas` manifest 的纯函数校验器与所有权字段 diff。 | 库 |
| [`sci-skills/`](sci-skills/README.zh.md) | 内置 skill 树、按内容 hash 同步进沙箱、生命周期策展、listing provider。 | `ctx.skills` provider |
| [`sci-workspace/`](sci-workspace/README.zh.md) | `tools/pre-execute` 上的路径策略与 shell 预检：交付区、只追加的 `versions/`、manifest 所有权。 | `tools/pre-execute` |
| [`sci-deliver/`](sci-deliver/README.zh.md) | `deliver_files` 工具与沙箱内 `sci deliver` spool，同一条校验链。 | `ctx.tools` |
| [`sci-memory/`](sci-memory/README.zh.md) | 带 `originSessionId` 的记忆节点、写入时序投影、recall RPC。 | `tools/post-execute`、RPC |
| [`sci-plan/`](sci-plan/README.zh.md) | `declare_research_plan` 工具与 `sci/plan-declared` 事件。 | `ctx.tools` |
| [`sci-guard/`](sci-guard/README.zh.md) | 不可逆操作分类器：未签名二进制、外发、凭据、破坏性删除 → approval。 | `tools/pre-execute` |
| [`sci-audit/`](sci-audit/README.zh.md) | session log 投影到六张审计表；可重建。 | `ctx.storageDomain` |
| [`sci-tier/`](sci-tier/README.zh.md) | 两个档位，界面显示 `单体 / Solo` 与 `蜂群 / Swarm`：档位段、fan-out guard、先声明后扇出 latch、升档建议、fork RPC。 | `ctx.tools.guard`、`tools/pre-execute`、RPC |
| [`sci-remote-hosts/`](sci-remote-hosts/README.zh.md) | 用户 SSH 主机作为沙箱 `~/.ssh/config` 里的托管块。 | RPC |
| [`sci-profile/`](sci-profile/README.zh.md) | `dsh-sci` bundle：profile patch 层、两个档位 preset、六个人格、可运行示例、snapshot。 | profile |

Dormice 沙箱 provider 与其他远程运行时 provider 放在一起：[`../e2b/dormice/`](../e2b/dormice/README.zh.md)。
