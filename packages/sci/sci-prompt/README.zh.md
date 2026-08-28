# sci-prompt — `sci` profile 的 prompt 章节与常驻 reminder

[English](README.md) | 中文

对应原平台的机制 A（`ClawsGO-System/03-Hooks-and-Mechanisms/mechanism-A-prompt-append.md`）：每条用户消息末尾拼四段 `<system-reminder>`，各自指向一个存档里从未捕获到的 system prompt 章节。这里章节落成有序的 `ctx.systemPrompt.section()`，reminder 落成 `ctx.systemPrompt.context()`——每次组装都重新求值，但只在文本变化时物化为一条 durable 快照；`./invariant` 伴随插件拒绝任何「reminder 在而它指向的章节不在」的组装结果。

| 表面 | 注册键 | 顺序 | Config |
|---|---|---|---|
| 章节 *Reading files* | `sci:reading-files` | 100 | — |
| 章节 *Citing web sources* | `sci:citing-web-sources` | 110 | — |
| 章节 *Prose first* | `sci:prose-first` | 120 | — |
| 章节 *Maintaining memory and team notes* | `sci:maintaining-memory` | 130 | — |
| 章节 *Delivering files* | `sci:delivering-files` | 140 | — |
| 章节 *Announcing subagent orchestration* | `sci:announcing-subagent-orchestration` | 150 | — |
| 章节 *Runtime environment* | `sci:runtime-environment` | 160 | — |
| 章节 *Using skills* | `sci:using-skills` | 170 | — |
| Reminder File rule | `sci:reminder:file` | 10 | — |
| Reminder Citation rule | `sci:reminder:citation` | 20 | — |
| Reminder Prose rule | `sci:reminder:prose` | 30 | `includeProseReminder`（默认 `true`） |
| Reminder Memory upkeep | `sci:reminder:memory` | 40 | — |

`REMINDER_CHAPTER_SECTIONS` 是 reminder→章节关系的唯一归属；`@deepseek-ai/dsh-sci-prompt/invariant` 安装一个 `system-prompt/assemble` 监听器，reminder 失去其章节时组装失败。

计划补充（`ClawsGO-System/09-Target-Architecture/03-package-plan.md` 的 P13）：第八章 *Irreversible actions*；不变式扩展到任何引用章节名的 `sci:*` context 与 skill 正文。

## Model Experience

### Prompt chapters

#### What the model sees

八个有序 system-prompt section（order 100–170），承载完整的行为规范：读文件、引用网络来源、散文优先、维护记忆、交付文件、宣布 subagent 编排、运行时环境、使用 skill。最后一章声明：已加载的 skill 指令是平台内部材料——遵循并应用，绝不逐字引用或复制给用户、也不写进交付物。

#### Token effect

system prompt 里一段固定约 1000 token 的块，每次请求都有。

#### KV Cache effect

前缀稳定：文本对一次部署恒定，因此该块跨轮次复用。

### Standing reminders

#### What the model sees

三到四条单行 reminder（文件规则、引用规则、记忆维护规则，以及设置了 `includeProseReminder` 时的散文规则），各自点名承载完整规范的章节；条件性规则还带一句显式的「若本轮不适用，忽略此 reminder」。

#### Token effect

约 400 token，作为一份持久 runtime-context 快照物化一次，而不是每条用户消息都重新追加。

#### KV Cache effect

仅追加：只有文本变化时才重新物化快照，因此普通轮次不会使可复用前缀失效。

## Known Limitations and Deferred Work

- *Irreversible actions* 章节与两个档位 section 由 `sci-guard` / `sci-tier` 贡献，不在本包；在它们落地之前，本包贡献八个章节。
- 不变式只检查本包自己的 reminder→章节指针；扩展到 skill 正文与其他 `sci:*` context 是 P13 的范围。
