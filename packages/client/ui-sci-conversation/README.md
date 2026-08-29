# @deepseek-ai/dsh-client-ui-sci-conversation

English | [中文](README.zh.md)

The CaMeL Science reading of the conversation flow: one uniform card per tool call, a live agent galaxy inside the delegating ones, a chip row for the files a turn produced, a header button that opens them, and a token-only skin over the shipped chat surfaces. Every contribution goes into a seat [ui-conversation](../ui-conversation/README.md) already owns, so composing this package out of cordis.yml restores the shipped flow exactly. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

The tool card fills [ui-tool](../ui-tool/README.md)'s `tool.call.frame`, the single seat around one whole call. That seat exists because the alternative does not work: shadowing the `tool-call` Chat Node entry also shadows its `children` declaration, and a child slot admits exactly one declarer, so the shadowing entry could never re-declare `tool.call.toolview` and every per-tool view would stop rendering. Framing keeps that dispatch in ui-tool, which hands this card the already-rendered per-tool view as `body` — so the workbench restyles every call and displaces none of them.

The chip row registers into the `conversation.chat.turnTail` chain at `priority: -10`, below [ui-deliverables](../ui-deliverables/README.md)'s default `0`, so it is tried first; a chain elects exactly one winner, which is what makes the chips replace that package's produced-files row rather than double it. Its claim unions two Turn-scoped readings rather than picking between them: Deliverables knows every mutation the turn landed (by render intent, not by tool name), and this package's own `sciArtifacts` Turn data knows the hand-overs and office exports that write through no mutation card. A researcher means both by "output", so the row claims on either and lists both, mutations first.

That second reading is one Turn-scoped `ConversationNodeDefinition` registered here. It folds the settled `deliver_files` and `univer_export` calls of a turn — pairing each `tool/result` back to the `tool/call` that named the file, because a settlement carries the outcome and never the arguments — and publishes them as Turn data. It renders no node of its own.

The card head is uniform on purpose — glyph, noun, argument summary, elapsed, state — because a research flow is read by scanning it. The noun comes from [ui-sci-files](../ui-sci-files/README.md)'s `toolDisplayName`, so the card and the details panel read one call the same way by construction; this package adds only the glyph. The summary is the call's first string argument on one line, which is where every tool of this harness puts its subject. Elapsed is the settled pair's own timestamps, or a live second counter while the call runs — the counter exists only while that call is in flight, so a settled transcript mounts no timers at all.

The galaxy replaces the body of a `subagent` or `workflow` card, and its membership is the Chat Location index's answer rather than a scan: a settled `tool-result` node carries no turn of its own, so `chat.locations.getTurn(turn)` is the only place the turn's sibling delegations exist, and the frame owner supplies the turn number that addresses it. Each row is labelled from the call's own arguments (`description` for a subagent, the `meta` identity block for a workflow) and falls back to the tool's noun. The header shows the turn's wall time and summed output tokens, and the per-agent token column appears only when at least one result reported usage — a column of dashes would claim the board knows something it does not.

The skin is a plugin-lifetime `<style>` element, the same technique [ui-brand-sci](../ui-brand-sci/README.md) uses for its motion base. Every rule selects a stable `data-*` attribute the shipped conversation writes on purpose and then redefines a token that surface already reads; no CSS-module class is targeted and no literal colour appears. The attributes it depends on are listed under Known Limitations.

The `/client` exports are the plugin body (`apply`/`inject`) alone — the components and the derivations stay package-internal behind the slot registrations.

## Model Experience

None, as this is a browser-side presentation package whose Node half is an inert loader seat: it registers no tool, prompt section, or session event, and everything it draws is derived at render from the conversation snapshot the browser already holds.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **A settled delegation's galaxy stops ticking on its own.** The live clock belongs to the card whose own call is running, so a `subagent` card that has settled while a sibling delegation still runs refreshes only when the session publishes its next snapshot. During a running turn that is continuous, so the visible effect is confined to an idle tail.
- **The card body for an unplaced delegating call is the ordinary tool view.** The galaxy needs the turn to address its siblings, and a Chat Node whose placement the engine could not resolve reports none; that call renders its own tool view instead of an empty board.
- **The skin depends on eight attributes of the shipped conversation.** `[data-phase]` (conversation root, also the declaring site of `--dsh-chat-content-width`), `[data-phase='hero']`, `[data-chat-flow-kind='user']` and `[data-chat-flow-kind='steering']` (chat node seats), `[data-chat-flow-kind='assistant-step']`, `[data-turn-tail]`, and `[data-composer-card]` (composer card). Renaming or dropping any of them silently drops the rule that reads it; nothing fails loud, because CSS has no such mechanism. The composer rule redefines `--dsw-alias-button-info-fill` and `--dsw-alias-button-info-hover` scoped to the card, so any other element inside the composer that reads those tokens takes the gradient too.
- **The `subagent` result's token count is read optimistically.** The board looks for `meta.usage.outputTokens` on a settled delegation because that is where a child run's usage would ride; nothing in the wire contract requires it, so on a deployment that reports none the whole token column is absent rather than zeroed.
