# dsh-auth

English | [中文](README.zh.md)

Service Definition of the [authentication and authorization](../README.md) capability seam: who a request speaks for, what their groups permit, and the primitives that keep passwords and one-time secrets non-reversible at rest.

## Principal

```ts ignore-check
type Principal =
  | { kind: 'user'; userId: UserId; email: string; groups: readonly GroupId[]; admin: boolean }
  | { kind: 'local' }
```

`local` is the in-process principal: the CLI, ACP automation, tests, and any composition that mounts no auth provider. It carries full rights, so a deployment that does not mount authentication behaves exactly as it did before this package existed. Authorization is therefore opt-in composition, never a silent behavior change.

## Permission rules

```ts ignore-check
type PermissionDomain = 'skill' | 'tool' | 'model' | 'settings-section'
interface PermissionRule { domain: PermissionDomain; pattern: string; effect: 'allow' | 'deny' }

function evaluate(rules: readonly PermissionRule[], domain: PermissionDomain, name: string): boolean
function governs(rules: readonly PermissionRule[], domain: PermissionDomain): boolean
function permits(principal: Principal, rules: readonly PermissionRule[], domain: PermissionDomain, name: string): boolean
```

Precedence is **deny > allow > default-deny**: a matching `deny` settles the question, a matching `allow` grants, and a name no rule mentions is refused. A `pattern` is an exact name or a trailing-`*` prefix glob; `model` patterns read `provider/model`. `evaluate` is that algebra alone, and an administration surface previewing what a group grants calls it directly.

`permits` is the entry point every Consumer calls, and it adds two steps around `evaluate`. `local` and `admin: true` bypass evaluation entirely. Then **governance is per domain and opt-in**: a domain no rule addresses (`governs` is false) grants every name in it, and one rule anywhere in a domain makes the whole domain rule-decided. Default-deny still applies inside a governed domain, so `allow skill:onboarding` is an exact allowlist for skills — and leaves that group's tools, models, and settings sections untouched.

Without the opt-in step a freshly created group would take the entire product away from its members, because a group starts with no rules at all and default-deny would then refuse every skill, tool, model route, and settings namespace. Granting a capability is therefore always a deliberate narrowing of one named domain.

```ts ignore-check
type PermissionCheck = (domain: PermissionDomain, name: string) => boolean
function checkForSessionOwner(auth: AuthService, sessionId: SessionId): Promise<PermissionCheck>
```

A running agent carries no `Principal`; it acts for whichever account owns its session. `checkForSessionOwner` resolves that owner's decision once — `PERMITS_EVERYTHING` for a session recorded before authentication was mounted, `PERMITS_NOTHING` for an owner that no longer resolves — so the model-facing skill catalog and the per-agent tool restriction cannot answer the same question two different ways.

## Password and token primitives

`hashPassword` / `verifyPassword` use node:crypto **scrypt** (N=2^15, r=8, p=1, 32-byte random salt, 32-byte hash) encoded as `scrypt$N$r$p$b64salt$b64hash`, compared with `timingSafeEqual`. scrypt is a Node builtin, so the deployment gains a memory-hard KDF with no native dependency to audit or rebuild. A plaintext password is never stored, returned, or logged.

`mintToken` returns a 256-bit base64url token with its SHA-256 digest; `mintCode` returns a 6-digit code with a per-code salt and `digestOfCode(salt, code)`. **Only digests are meant to reach storage** — the token or code exists as plaintext exactly once, in the reply or the e-mail that carries it. `sameDigest` compares in constant time.

## Service API

`AuthService` on `ctx.auth` declares the operations a provider implements: user records (roster, password, disable and restore, and `principalOf`, which resolves an account to its `Principal` without a credential), login verification, auth-session issue and revocation, one-time tokens for 2FA / e-mail verification / password reset, group, membership and rule administration, session and workspace ownership, and an audit append-and-read pair. Every member's contract is documented at this declaration; [dsh-auth-sqlite](../auth-sqlite/README.md) is the mounted implementation.

## Model Experience

None, as the seam decides who may call the Host and never contributes to a model request: no principal, rule, password, token, or audit record enters a prompt, tool schema, or tool result.

#### KV Cache effect

None; the package contributes no request content, so no prefix can be invalidated.

## Known Limitations and Deferred Work

- **Rules are flat per group** — a principal's effective rules are the union of their groups' rules with deny winning. Position carries no priority and there is no per-user override; a user who needs a different answer joins a different group. A provider still stores a group's rules in the order `setRules` received them, because that is the order an administration page redisplays.
- **Patterns are exact or prefix-glob only** — no regular expressions or character classes. The vocabulary grows when a deployment shows a rule it cannot express, not before.
- **No password policy beyond length** — composition, rotation, reuse history, and breach-list checks belong to whichever surface creates users; the seam only refuses to store a password reversibly.
