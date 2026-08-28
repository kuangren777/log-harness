# Agent Note: A science-research agent profile over dsh extension points

Status: proposed

English | [中文](2026-08-25-sci-research-agent-profile.zh.md)

## Problem

A studied research-agent platform (archived at `ClawsGO-System/`) delivers its entire product behaviour through server-side prompt assembly: standing per-turn reminders, two commercial tiers expressed as prompt segments, a session-start skill roster, a stdout sentinel parsed out of shell output, and a filesystem delivery contract stated only as prose. It ships zero hooks, zero plugins, and zero custom agent personas, because its runtime is a managed sandbox whose CLI it cannot modify.

That constraint produced three defects its own audit records. Ownership rules ("only `render.py` writes figures", "never touch `versions/`") have no enforcement, so compliance is a model choice. Tier gating ("do not fan out in Balanced mode") is a request, not a restriction. And a runtime assertion baked into the tier prompt — "the Workflow completion notification never arrives in this environment" — went stale and was contradicted by six delivered notifications, with no mechanism to retire it, leaving the model polling for nothing.

dsh has real extension points for all three. Reproducing the prompt-only design here would import the defects along with the behaviour.

## Proposal

Compose the product as a `sci` profile over a `dsh-sci` bundle plus packages under `packages/sci/`, mapping each prompt-only mechanism onto the typed point that enforces it:

- Standing reminders become `ctx.systemPrompt.context()` entries, deduplicated and versioned per assembly rather than re-appended verbatim to every user turn.
- The two tiers become two agent presets (`sci-balanced`, `sci-cluster`). Balanced omits the fan-out tool rows outright; the existing preset picker is the tier selector, so no new UI is required.
- "Declare the plan before fanning out" becomes a `tools/pre-execute` guard that denies the workflow tool until the declaration tool has succeeded in that session, replacing a prompt-level instruction with a gate.
- The workspace delivery contract becomes a `tools/pre-execute` policy over the mounted file tools, so `versions/` is append-only and delivery is restricted to the delivery directory by a gate rather than by prose. It cannot use `fs/write-intent` / `fs/edit-intent`: those are single-slot waterfalls already occupied by `dsh-fs-observation-policy`, whose read-before-edit guard this layer needs to keep. Deletes have no file-seam verb at all, so the sandbox's own ownership split is what stops them.
- The stdout sentinel is dropped. Its only advantage was interleaving inside shell control flow; a first-class `deliver_files` tool carries a validated schema and a rendered result instead.
- The stale notification assertion is not carried over. dsh's workflow tool blocks the parent turn until the run settles, so the condition it described does not exist here. The `resumeFromRunId` recovery it paired with is dropped for the same reason: dsh has no workflow resume, and a prompt must not promise a capability the runtime lacks. The subagent tools DO deliver a completion notice in continuable mode, so the runtime chapter states both facts rather than one blanket rule.

Skills port as ordinary skill directories under the bundle's own skill root. Workbench-backed formats (`.paper`, `.sciplot`, `.canvas`) keep their file contracts but degrade to plain file delivery, because the studied platform's front end is not part of the archive and is out of scope.

## Alternatives considered

**Port the prompt-only design as-is.** It is what the studied platform proves works, and it needs no extension points. Rejected because it imports the three defects that platform's own audit records: a runtime assertion that went stale with no mechanism to retire it, a contract directory whose managing skill was withdrawn, and a memory rule with an escape clause that measured zero compliance. Here the equivalent rules are gates, and a prompt that asserts a runtime fact must carry an invariant that checks it.

**Enforce everything, keep no explanatory prose.** Smaller and unambiguous. Rejected because the tier gate's value is not only the refusal: the studied platform's balanced-tier segment states what the user chose, why the ceiling exists, whose budget it protects, and what the legitimate exit is, and a model that understands the boundary does not fake the capability or degrade silently. The gate makes the rule true; the prose makes the refusal intelligible.

**One tier with a runtime switch instead of two presets.** Would allow changing tier mid-conversation. Rejected because a preset is a standing composition mounted once per id, so the tool catalog itself differs between tiers — which is what makes the balanced ceiling real rather than advisory. The cost is that upgrading means a new session, so the upgrade path creates one seeded from the old rather than mutating it.

## Acceptance criteria

Every mechanism above lands on the named extension point, with a test that the gate refuses the call the studied platform only discouraged: a balanced-tier session cannot reach a fan-out tool, a fan-out without a declared plan is refused, a write into `versions/` is refused at the tool layer and again by sandbox ownership, a delivery outside the delivery directory is refused, and running an unsigned binary becomes an authorization question. Each package's README names the mechanism it replaces and what changed. Five keyless snapshots record the model-visible refusals so a regression shows up as a transcript diff.

## Risks

The gates reject calls that used to succeed, so a task the studied platform completed by ignoring its own prose may now fail loudly; that is the intent, but it makes the layer's first real workloads the place where over-strict rules surface. The sandbox ownership split is the last line for anything that bypasses the tool layer through a shell, and it depends on image construction rather than on code in this repository — an image built without it silently loses the `versions/` guarantee while every test still passes. And a prompt chapter can still drift from the runtime it describes: the invariant companions check the relationships this layer owns, not every sentence.

## Consequences

Behaviour that was advisory becomes enforced, which will reject calls the studied system merely discouraged. Tier membership becomes a composition fact fixed when the session starts rather than a per-turn prompt segment, so a session cannot change tier mid-conversation without a new session.
