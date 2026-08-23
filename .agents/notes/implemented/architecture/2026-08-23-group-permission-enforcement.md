# Agent Note: Group permission enforcement — where each domain is decided, and what a rule-less group keeps

Status: implemented

English | [中文](2026-08-23-group-permission-enforcement.zh.md)

## Problem

The auth seam shipped a rule vocabulary — `skill`, `tool`, `model`, `settings-section`, with deny > allow > default-deny over the union of a principal's groups — and nothing consulted it. A deployment could write rules and watch every one of them do nothing: the composer still listed every skill, the model still saw every skill in its catalog, every agent still resolved every tool, every route was selectable, and the configuration plane answered every namespace. The `notifyAddedToGroup` template had no caller for the same reason, since no surface changed group membership.

Two questions had to be answered before the rules could govern anything. First, WHERE each domain is decided: a filter in a list projection is not enforcement when a direct or alternate caller reaches the executor. Second, what a group with no rules means, because `evaluate`'s default-deny answers "nothing" and a freshly created group carries no rules.

## Decision

**A domain no rule addresses is ungoverned, and grants everything in it.** `permits` — the entry point every Consumer calls — now runs `governs(rules, domain)` before `evaluate`, and grants when no rule in the principal's whole rule set names that domain. `evaluate` keeps its default-deny algebra untouched, so a governed domain remains an exact allowlist and an administration surface previewing a group still calls `evaluate` for the unbypassed answer.

The alternative reading, "a group with no rules gets nothing", makes the feature unusable in the only order an administrator can actually work in: creating a group is the first step, and it would immediately take every skill, tool, model route, and settings section away from its members. It also makes each grant unbounded in scope — `allow skill:onboarding` would have to be accompanied by an enumeration of every tool, model, and namespace the group still needs. Per-domain opt-in keeps a grant a narrowing of the one domain it names, which is what an administrator means by writing it.

**Each domain is enforced in the operation that makes its decision.**

- `skill`, request side — the `skill.list` and `skill.inventory` handlers in `api-proxy.ts`, filtering the registry's own result before it is projected onto the wire. `inventory` OMITS a refused entry rather than marking it, because that view is the product's richest disclosure of a skill (description, origin, absolute path) and a marked row would hand a refused account everything except the body. Origin groups survive an emptied entry list, since what the project discovered does not depend on who asks.
- `skill`, model side — `dsh-tool-skill`, filtering `ctx.skills.snapshot()` BEFORE the catalog entries are built, plus a re-check in the `skill` tool's `execute` and in the `/name` gesture listener. Three points because the catalog is prompt content, not a gate: a model naming a skill from an earlier turn, a forked session, or a guess reaches the executor directly, and a user typing `/name` reaches the injection directly.
- `tool` — a scoped `tools.restrict({ allow })` in `dsh-auth-gate`, which removes the tool from the prompt AND refuses its execution. Nothing weaker qualifies: prompt filtering alone leaves the executor reachable.
- `model` — an `agent/request` waterfall listener in `dsh-auth-gate`, reading the config AFTER `next()` so it sees the route the session's selection actually produced. `session.selectModel` and the `llm.models` / `session.models` catalogs are narrowed too, but as affordances: the picker is bypassable and a catalog is advisory, so the turn's own request is the decision point.
- `settings-section` — `settings.describe` filters, and `update` / `replace` / `mutate` refuse before touching the seam so a refused namespace cannot be probed for existence or validation behavior. `openDocument` requires EVERY registered namespace, because the document is all of them in one editable file and the handoff cannot be scoped to a subset.

**Catalog filtering precedes publication, so "model-visible ⟺ logged" holds with no format change.** The durable `skill-catalog` message records the entries it published; filtering the rendered `<available_skills>` prose instead would leave the session log claiming a catalog that was never sent. Because the filter moves the source list, the message stays a faithful record and needs no new `SessionEventMap` member and no `SESSION_FORMAT_VERSION` bump — the catalog was always a projection of a per-session view, and this narrows the view.

**A running agent has no principal, so `checkForSessionOwner` is the one resolution both agent-plane Consumers share.** It returns a `PermissionCheck` closure: `PERMITS_EVERYTHING` for a session with no recorded owner, `PERMITS_NOTHING` for an owner the provider can no longer resolve (deleted or disabled), and the owner's real decision otherwise. It needed `AuthService.principalOf(userId)`, because the administrator bypass reads `Principal.admin` and a Consumer reconstructing that from a group list would be free to get it wrong.

**Three paths keep today's behavior exactly.** No auth provider mounted: every Consumer reads `ctx.get('auth')` optionally and grants everything. A session with no recorded owner: created before authentication was mounted, and taking its capabilities away would break a conversation nobody chose to restrict. An administrator: `permits` bypasses evaluation, so `skill.inventory` and `settings.describe` still show an administrator everything a restricted user cannot see, which is what makes the administration surface usable.

**The administration plane is nine `admin` RPC rows.** `auth.admin.users.list/create/disable`, `groups.list/create/delete/rename`, `members.set`, `rules.set`, each a row in `RpcMethodMap`, `UNARY_ROUTES`, and `METHOD_POLICY`. `owner` is not offered for them: they decide what every other row admits, so a caller who reached one could grant itself the rest. `members.set` computes the newly added accounts against the membership held BEFORE its write, then — after the write is durable — calls the gate's `notifyAddedToGroup` for exactly those accounts and writes one audit row. That ordering is the whole contract: the membership is the commit and the notice is a courtesy, so a mail failure is logged and the save stands.

## Consequences

`permits` changed meaning for an ungoverned domain, and `packages/auth/auth/tests/rbac.spec.ts` changed with it: `permits(member, [], 'tool', 'bash')` is now `true`. `evaluate` is unchanged, and remains the function to call for the raw algebra.

The seam grew three members — `listUsers`, `setUserDisabled`, `principalOf` — implemented in `dsh-auth-sqlite` over the existing tables with no schema change. `setUserDisabled` takes a boolean rather than being one-way, so a mistaken block is not a database repair; it does not revoke live sessions, which stays the separate decision `revokeAllSessions` already is.

`RequestGate` gained `notifyAddedToGroup`, because the gateway is now the caller and the template stays with the gate that owns every other message the deployment sends. `ToolRegistry.restrictableNames(scope)` was added for the same reason a policy-derived allowlist needs it: `schemas()` already has masks applied and carries scope-local names and the reserved transport, all of which `restrict` refuses.

The tool restriction is installed from `agent/session-start`, which is an `emit` the loop does not await. A prepended `agent/pre-step` listener awaits the same memoized promise, so the mask is in force before any step turns tool visibility into a prompt, and a failed resolution surfaces to the turn that is blocked on it rather than as an unhandled rejection. The resolution is per agent and happens once: a rule change reaches a live agent only when its next agent is created.

Two surfaces are gated at `admin` by `METHOD_POLICY` today — `skill.inventory` and the whole `settings.*` plane — so their rule checks only ever remove something for a non-administrator principal reaching the `ApiProxy` in process, or after a deployment widens those rows. They are implemented and tested anyway, because the alternative is a filter that lives in the policy table alone and silently disappears the moment the row changes.

`session.create` is NOT model-gated. Its payload names no provider or model, the session takes the deployment default, and refusing the create would leave an account unable to open the session in which it could pick a permitted route. The first turn's `agent/request` is where a disallowed default is refused, and it names the route.

## Alternatives considered

- **Default-deny across all domains for a group with no rules** — correct as an algebra, unusable as a product: creating a group would revoke everything from its members, and every grant would have to enumerate the whole product to be safe.
- **A builtin "everyone" group seeded with `allow *` per domain** — moves the same decision into bootstrap state, where an operator can delete it and silently lock the deployment out. Behavior that must hold is better expressed in the function than in a row.
- **Filtering the rendered catalog prose instead of the snapshot** — would leave the durable `skill-catalog` entries describing a catalog the model never received, breaking the one invariant that makes the session log replayable.
- **Marking refused entries in `skill.inventory` rather than omitting them** — keeps the name, description, and host path of a skill the rules refuse; the inventory is a disclosure surface, not a menu.
- **Enforcing the model domain only at `session.selectModel`** — a picker is an affordance. A session whose logged selection predates the rule, or a client calling the method it likes, would route to a refused model with nothing left to stop it.
- **Adding a session event for the filtered catalog** — unnecessary once the filter precedes publication, and it would have cost a `SESSION_FORMAT_VERSION` bump for a fact the existing message already records.
- **A synchronous tool restriction at `agent/session-start` alone** — the event is `emit`, so nothing awaits the listener and the first step could assemble a prompt before the mask existed.
