# Agent Note: Per-skill invocation policy from the user settings document

Status: implemented

English | [中文](2026-08-22-skill-policy-overrides.zh.md)

## Problem

A skill's two invocation surfaces were decided entirely by whoever authored it: `disable-model-invocation` and `user-invocable` frontmatter, or the policy a runtime contribution passed to `register()`. A user who wanted a bundled or shared skill out of the model's catalog — or a noisy one out of their own `/` menu — had to edit a file they may not own, and a packaged skill root cannot be edited at all. [Layered discovery](2026-08-22-layered-skill-discovery.md) widened the set of roots a session sees, which made the gap sharper rather than smaller.

## Decision

`SkillRegistry` owns a `skills` user-settings namespace: a dictionary keyed by skill name whose entries carry the optional booleans `model` and `user`. A present field replaces that surface, an absent one keeps the authored value, and `applyPolicyOverride(authored, override)` is the single resolver. Settings win over frontmatter.

The registry owns the namespace because it owns the policy decision every consumer reads. Registration rides `ctx.inject(['settings'], …)`, the canonical optional-settings wiring: no settings service ever mounted means the authored policy stands and nothing fails. The `validate` hook rejects a key that is not a valid skill name — the schema cannot express the grammar, and a misspelled key would otherwise be stored as an override that can never match a skill.

The key is the skill name alone because layer merging already resolves exactly one winner per name, so one entry addresses whichever contribution the viewer actually sees. Overrides therefore apply to the merged winner at the end of `collectFresh`, and again to the definition `get()` loads, so a consumer enforcing its surface on the definition sees what the catalog advertised. `IndexedCandidate` carries the effective policy beside the provider's own candidate object rather than rewriting it: the provider contract promises `get()` receives the same candidate `list()` returned.

Every committed change invalidates the collect cache and emits `skills/change`; an attach or detach carrying no override moves nothing and stays silent. `dsh-tool-skill` needs no code: its next pre-step recomputes the snapshot, the digest differs, and one complete replacement catalog is appended.

`SkillRegistry.inventory()` reports every discovered candidate grouped by origin — layer, source, rank, root — nearest layer first, including the shadowed losers the catalog hides, each carrying its authored policy, effective policy, override, and `shadowed` flag. It exists because a user editing invocation policy needs to see what exists and why an entry is not winning, which the winner-only catalog cannot answer.

## Behavior matrix

| Stored override | Model catalog and `skill` tool | User command menu and `/name` gesture |
|---|---|---|
| `{ model: false }` | hidden; a call on the name is refused | listed and injected |
| `{ user: false }` | listed and loadable | absent; `/name` stays ordinary prose |
| `{ model: false, user: false }` | hidden | hidden |

## Wire surface

The browser reads the inventory through one unary RPC, `skill.inventory({ sessionId })`, answered from the same session-to-cwd/scope resolution `skill.list` uses (`skillViewFor` in `packages/host/apiproxy/src/api-proxy.ts`): the header's project root plus the live agent's scope, else the recorded preset's standing key, with no Agent created or resumed. The wire types in `packages/host/apiproxy/src/api/skills.ts` restate the registry's report field for field instead of re-exporting it, because `api/` is browser-importable and must not pull a Host service package into a Client program; `source` widens to `string` there, since the host's origin vocabulary is open and a client renders an unrecognized bucket rather than switching on it.

`skill.list` is untouched: it stays the cached, user-invocable-filtered source the composer's `/` menu reads. The split follows the two questions — one answers what may be invoked, the other what exists and why it is not winning.

`skill.inventory` joins the privileged method set in `packages/client/connection/src/index.ts`. It projects the stored `skills` settings section and the absolute paths skills were discovered at, so it belongs beside `settings.describe`, whose namespace it reads a slice of and whose `settings.mutate` is the toggle's writer. `skill.list` stays unpinned: it carries neither paths nor overrides, and the composer's menu is not a configuration surface.

`skills/change` joins `API_REMOTE_FORWARDED_EVENTS`, which is what makes a toggle visible without a reload — the first consumer that event has had. Because it names neither session nor skill, `dsh-client-ui-skill` drops every cached catalog on it and the next `/` refetches. Forwarding it required a client-safe `./types` face on `@deepseek-ai/dsh-skill`: `$on`'s key set is `keyof Events` in the CONSUMER's compilation face, and the declaration previously sat in the Host-only `index.ts`.

## Browser Skills section

`@deepseek-ai/dsh-client-ui-settings-skills` registers its own `settings.section` entry, id `skills`, order 12 — between Models at 10 and Plugins at 15. It is deliberately not a tab inside Plugins: that section projects the Cordis Loader inventory, which reports what the deployment mounted, while this one edits policy over what the session's project discovered. Neither list is a subset of the other, and a user looking for a skill would not find it under a heading about plugins.

The page is addressed by the current session, because discovery resolves from that session's working directory and Settings is a root surface with no session of its own. With no current session there is nothing to address, so the page settles into an explained empty view rather than listing a stale project. Groups render nearest-first exactly as `inventory()` returned them — the section adds no ordering of its own — and each origin is titled from a closed table keyed by the host's bucket, falling back to the raw string, which is the client half of the wire decision to widen `source` to `string`.

A row is marked overridden when its entry carries an `override` at all, not when the effective policy differs from the authored one. Presence is what the rest of the settings surface already reads (`SettingsScopeSnapshot.user` documents the raw user layer, where a field's presence — not its value — marks it overridden), and it is the only reading under which Reset stays reachable: an override whose value happens to equal the authored policy is still a stored entry, and a value comparison would strand it in the document with nothing offering to clear it. Reset is `scope.unset(name)`; a toggle is `scope.set(name, { ...storedOverride, [surface]: next })`, spreading the stored entry because one entry carries both surfaces and a partial patch would silently drop the decision the user did not touch.

Nothing renders optimistically. The page re-reads `skill.inventory` once a write settles, so a row always shows what the Host resolved rather than what the click intended. It also re-reads on the forwarded `skills/change` and on `connection/reset`, both behind a loaded guard: a page the user has never opened stays `idle` and costs no RPC on background invalidation. The session-list feed is watched too, but a refetch fires only when the current session actually moves — that feed also publishes recency and job churn, which must not each cost a wire call. Shadowed rows render read-only, because an override on a loser would address a name a nearer definition already claimed.

## Alternatives considered

**Let a settings section rewrite the frontmatter file.** Rejected: packaged and read-only roots cannot be edited, and a user override that mutates a shared source destroys the authored value it overrides.

**Key overrides by source, root, or absolute path.** Rejected without a current consumer: the surfaces a user acts from — the catalog, the `/` menu, the `skill` tool — all address a skill by name, and merging guarantees one winner per name. A path key would also break the moment a nearer layer took over the name.

**Give the override three states per surface (`allow`/`deny`/`inherit`) instead of an optional boolean.** Rejected: an absent key already means inherit, and a stored `inherit` sentinel would be a second way to say nothing.

**Apply the override in each consumer instead of the registry.** Rejected: `dsh-tool-skill`, the command menu, and any future consumer would each have to read the section and combine it identically, and a consumer that forgot would silently expose a skill the user disabled. Enforcement belongs in the operation that resolves the policy.

**Cache the resolved section in the registry.** Rejected: `scope.get()` is already the resolved value, and a second copy would need its own invalidation to stay honest.

## Testing

`packages/skill/skill/tests/skill.spec.ts` covers the authored policy without a settings service, both single-surface overrides on `list()` and `get()`, notification and re-resolution on a committed change, key rejection, restoration on service disposal, the silent no-override attach and detach, and inventory grouping with `shadowed` and the override echo. `packages/skill/tool-skill/tests/tool-skill.spec.ts` covers the appended replacement catalog, the refused tool call, and the surviving `/name` injection. The keyless `skill-policy-override` ACP snapshot pins the assembled transcript: the model's `skill` call returns `Error: skill "snapshot-skill" is not available for model invocation`, no `<available_skills>` block advertises the skill, and the next turn's `/snapshot-skill` gesture injects its body. On the wire surface, `packages/host/apiproxy/tests/api-proxy-agent-preset.spec.ts` covers `skill.inventory`'s session resolution, its verbatim grouping, the omitted optional fields, the preset-mounted registry, and a rejected discovery; `rpc-schemas.spec.ts` and `fetch-carrier.spec.ts` pin the request/value schemas and the round trip; `packages/client/connection/tests/node-half.host.spec.ts` pins the privileged split against `skill.list`; and `packages/client/ui-skill/tests/browser-plugin.client.spec.ts` proves the forwarded `skills/change` clears every cached catalog.

On the browser surface, `packages/client/ui-settings-skills/tests/` covers the registration (id, order, the locale-following label thunk, the injected face, and teardown releasing both invalidation listeners), the controller (session-addressed reads, latest-read-wins over a superseded success and a superseded failure, override merging, the write-then-re-read, writability from the scope snapshot, and the session-move refetch), and the section (grouping and roots, an unrecognized origin rendered raw, both toggles against the effective policy, the override marker and its reset, a disabled shadowed row, the incomplete-discovery notice, the read-only posture, and the no-session and empty views). `apps/web/tests/skills-settings.e2e.ts` is the assembled journey: a real host discovers a seeded project root and user root, the shadowed loser renders disabled, one Model toggle lands in `$DSH_HOME/settings.yaml` while the other surface keeps its authored value, and Reset removes the entry. Adding it required pinning `DSH_CLAUDE_HOME` in `apps/web/tests/scaffold.ts` — the lane already pinned `DSH_HOME`, `DSH_AGENTS_HOME`, and `DSH_BUNDLED_SKILL_DIR`, so a developer's real `~/.claude/skills` was the one discovery root still reaching every journey, and a whole-dialog golden would have recorded it.

## Consequences

A user can retune any discovered skill's two surfaces from one document, including skills in roots they cannot write. The catalog stays honest at the cost of one appended replacement message per toggle flip, and a flip invalidates every cached catalog rather than the one affected name — the merged catalog is what carries the policy. Overrides accumulate silently: an entry naming a skill that no longer exists stays in the document, valid and inert, until `inventory()` or the user notices.
