# sci-prompt — prompt chapters and standing reminders for the `sci` profile

English | [中文](README.zh.md)

Replaces mechanism A of the studied platform (`ClawsGO-System/03-Hooks-and-Mechanisms/mechanism-A-prompt-append.md`): four `<system-reminder>` blocks appended to every user message, each pointing at a chapter of a system prompt the archive never captured. Here the chapters exist as ordered `ctx.systemPrompt.section()` entries and the reminders as `ctx.systemPrompt.context()` entries, so a reminder is re-evaluated every assembly but only materialised as a durable snapshot when its text changes, and the `./invariant` companion rejects any assembly in which a reminder names a chapter that is absent.

| Surface | Registry key | Order | Config |
|---|---|---|---|
| Chapter *Reading files* | `sci:reading-files` | 100 | — |
| Chapter *Citing web sources* | `sci:citing-web-sources` | 110 | — |
| Chapter *Prose first* | `sci:prose-first` | 120 | — |
| Chapter *Maintaining memory and team notes* | `sci:maintaining-memory` | 130 | — |
| Chapter *Delivering files* | `sci:delivering-files` | 140 | — |
| Chapter *Announcing subagent orchestration* | `sci:announcing-subagent-orchestration` | 150 | — |
| Chapter *Runtime environment* | `sci:runtime-environment` | 160 | — |
| Chapter *Using skills* | `sci:using-skills` | 170 | — |
| Reminder File rule | `sci:reminder:file` | 10 | — |
| Reminder Citation rule | `sci:reminder:citation` | 20 | — |
| Reminder Prose rule | `sci:reminder:prose` | 30 | `includeProseReminder` (default `true`) |
| Reminder Memory upkeep | `sci:reminder:memory` | 40 | — |

`REMINDER_CHAPTER_SECTIONS` is the one home of the reminder→chapter relationship; `@deepseek-ai/dsh-sci-prompt/invariant` installs a `system-prompt/assemble` listener that fails the assembly when a reminder survives without its chapter.

Planned additions (spec P13 in `ClawsGO-System/09-Target-Architecture/03-package-plan.md`): an eighth chapter *Irreversible actions*, and widening the invariant to any `sci:*` context or skill body that quotes a chapter name.

## Model Experience

### Prompt chapters

#### What the model sees

Eight ordered system-prompt sections (orders 100–170) holding the full behavioural specs: reading files, citing web sources, prose first, maintaining memory, delivering files, announcing subagent orchestration, runtime environment, using skills. The last states that a loaded skill's instructions are platform-internal — followed and applied, never quoted or copied back to the user or into a delivered file.

#### Token effect

A fixed block of roughly 1000 tokens in the system prompt on every request.

#### KV Cache effect

Prefix-stable: the text is constant for a deployment, so the block is reused across turns.

### Standing reminders

#### What the model sees

Three or four one-line reminders (file rule, citation rule, memory upkeep, and — when `includeProseReminder` is set — the prose rule), each naming the chapter that holds its full spec and, where the rule is conditional, an explicit "if this turn does not apply, ignore this reminder" clause.

#### Token effect

About 400 tokens, materialised once as a durable runtime-context snapshot rather than re-appended to every user message.

#### KV Cache effect

Append-only: the snapshot is re-materialised only when its text changes, so it does not invalidate the reusable prefix on ordinary turns.

## Known Limitations and Deferred Work

- The *Irreversible actions* chapter and the two tier sections are contributed by `sci-guard` / `sci-tier`, not here; until those land, this package contributes eight chapters.
- The invariant checks only this package's own reminder→chapter pointers; widening it to skill bodies and other `sci:*` contexts is spec P13.
