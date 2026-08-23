# Agent Note: Authentication and authorization capability seam

Status: implemented

English | [中文](2026-08-23-auth-capability-design.zh.md)

## Problem

The Host served one implicitly trusted operator. The browser-trust fence ([api-request-trust](../../../../packages/client/connection/src/api-request-trust.ts)) answers "did this request come from a declared authority", which defends against DNS rebinding and cross-site calls but says nothing about who is asking. A deployment that serves several people over a tailnet therefore had no way to keep one person out of another's sessions, or to decide that a group may not see a given skill. `packages/client/connection/src/index.ts` already carried the comment that the configuration plane "stays loopback-same-origin until a real authentication"; this is that authentication.

## Decision

Two packages form the seam. `dsh-auth` owns the vocabulary and the primitives; `dsh-auth-sqlite` owns the records. Nothing in either package mounts itself into a shipped composition, so the capability is opt-in and every existing deployment and keyless snapshot is unchanged.

### The `local` principal keeps auth optional

`Principal` is either a user or `{ kind: 'local' }`, and `local` carries full rights. The CLI, ACP automation, in-process tests, and any composition without an auth provider all speak as `local`, so adding this family to the repository changed no existing behavior. Authorization becomes real only where a deployment mounts a provider and the gate resolves a user instead.

### Deny beats allow, and silence denies

`evaluate` resolves a name against a group's rules as **deny > allow > default-deny**. Default-deny is the load-bearing half: a skill, tool, model, or settings section that no rule mentions is invisible to a restricted group. A capability added later is therefore safe on arrival rather than exposed until someone remembers to forbid it. `permits` layers the principal on top, short-circuiting for `local` and for `admin`.

Rules are flat and unioned across a user's groups. Ordering and priority were rejected: with deny winning, precedence between two rules is already decided, and an ordered list would let one group's rule silently weaken another's. Position is still durable, because it is what an administration page redisplays: `setRules` writes each rule's index into the `rules.ordinal` column and `listRules` reads by it, so a group comes back in the order it was saved instead of the order the storage engine finds cheapest. That is presentation, not precedence — `evaluate` never reads a rule's position, and a group whose rules arrive shuffled decides every name the same way.

### scrypt, not argon2id

Password hashing uses node:crypto scrypt (N=2^15, r=8, p=1). argon2id is the stronger primitive on paper, but every Node implementation is a native addon: a compiled dependency in the supply chain, a rebuild per platform in a repository that already ships a Windows lane, and an audit burden for the one package that must never be wrong. scrypt is memory-hard, built in, and sanctioned for password storage. The encoded form names its parameters, so raising the cost later does not invalidate stored hashes.

### Only digests reach storage

Auth-session tokens and one-time codes are generated once, returned once, and stored only as SHA-256 digests; lookup is by digest and confirmation is `timingSafeEqual`. A stolen copy of `auth.db` yields nothing replayable. The audit log follows the same rule and records no secret material.

### Ownership lives in auth.db, not the session log

`session_owners` and `workspace_owners` map a resource to its creator inside the auth database. Putting ownership into `SessionHeader` would have been the more obvious home, but it would bump `SESSION_FORMAT_VERSION` and make every existing session log unreadable to a build that knows about users — a large blast radius for a fact the agent loop never reads. Keeping ownership beside the users it references also means deleting the auth database removes the whole multi-user layer cleanly.

### Rate limits are durable and are not configuration

Password, 2FA-send, and reset windows live in a `rate_events` table, so a lockout survives a restart instead of being cleared by one. The limits are fixed constants: a deployment that can widen its own brute-force window has not been given a knob, it has been given a way to disable a security control.

## Alternatives considered

**Reuse `packages/identity` as the principal.** Rejected. That package is `dsh-anonymous-user-id`, a random per-home UUID for telemetry and the DeepSeek correlation header, documented as never derived from an identifying source. Making it a credential would break that promise and give every unauthenticated process an identity that looks authoritative.

**Express permissions through `permission-presets`.** Rejected. Presets bundle `sandbox/mode` with `approval/policy` and are pinned per session at creation: they answer how much a running session may do, not who the caller is. Folding authorization in would tie a security decision to a session-scoped UX control.

**Migrate the schema on version drift.** Rejected. `AUTH_SCHEMA_VERSION` is rejected rather than migrated, matching the repository's pre-release stance; silently reinterpreting credential rows written by another build is a worse failure than refusing to start. Version 2, which gave `rules` its `ordinal` column, is the policy's first exercise: an existing `auth.db` is recreated rather than upgraded.

## Consequences

The repository gains an `auth/` package group and a SQLite database at `$DSH_HOME/auth.db` in deployments that mount it. Enforcement is not part of this note: the gate that resolves a principal per request, and the group filters over skills, tools, models, settings, and session ownership, land with the stages that follow. Until then these packages are inert — which is exactly why they could land without touching a single existing test.
