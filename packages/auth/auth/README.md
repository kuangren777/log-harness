# dsh-auth

English | [中文](README.zh.md)

Service Definition of the [authentication and authorization](../README.md) capability seam: who a request speaks for, what their groups permit, and the primitives that keep passwords and one-time secrets non-reversible at rest.

## Principal

```ts
type Principal =
  | { kind: 'user'; userId: UserId; email: string; groups: readonly GroupId[]; admin: boolean }
  | { kind: 'local' }
```

`local` is the in-process principal: the CLI, ACP automation, tests, and any composition that mounts no auth provider. It carries full rights, so a deployment that does not mount authentication behaves exactly as it did before this package existed. Authorization is therefore opt-in composition, never a silent behavior change.

## Permission rules

```ts
type PermissionDomain = 'skill' | 'tool' | 'model' | 'settings-section'
interface PermissionRule { domain: PermissionDomain; pattern: string; effect: 'allow' | 'deny' }

function evaluate(rules: readonly PermissionRule[], domain: PermissionDomain, name: string): boolean
function permits(principal: Principal, rules: readonly PermissionRule[], domain: PermissionDomain, name: string): boolean
```

Precedence is **deny > allow > default-deny**: a matching `deny` settles the question, a matching `allow` grants, and a name no rule mentions is refused. A `pattern` is an exact name or a trailing-`*` prefix glob; `model` patterns read `provider/model`. `permits` adds the principal: `local` and `admin: true` bypass evaluation, every other principal goes through `evaluate` against the union of their groups' rules.

Default-deny is what makes a new capability safe by construction: a skill, tool, model, or settings section that no rule names is invisible to a restricted group until someone grants it.

## Password and token primitives

`hashPassword` / `verifyPassword` use node:crypto **scrypt** (N=2^15, r=8, p=1, 32-byte random salt, 32-byte hash) encoded as `scrypt$N$r$p$b64salt$b64hash`, compared with `timingSafeEqual`. scrypt is a Node builtin, so the deployment gains a memory-hard KDF with no native dependency to audit or rebuild. A plaintext password is never stored, returned, or logged.

`mintToken` returns a 256-bit base64url token with its SHA-256 digest; `mintCode` returns a 6-digit code with a per-code salt and `digestOfCode(salt, code)`. **Only digests are meant to reach storage** — the token or code exists as plaintext exactly once, in the reply or the e-mail that carries it. `sameDigest` compares in constant time.

## Service API

`AuthService` on `ctx.auth` declares the operations a provider implements: user and password records, login verification, auth-session issue and revocation, one-time tokens for 2FA / e-mail verification / password reset, group, membership and rule administration, session and workspace ownership, and an audit append-and-read pair. Every member's contract is documented at this declaration; [dsh-auth-sqlite](../auth-sqlite/README.md) is the mounted implementation.

## Model Experience

None, as the seam decides who may call the Host and never contributes to a model request: no principal, rule, password, token, or audit record enters a prompt, tool schema, or tool result.

#### KV Cache effect

None; the package contributes no request content, so no prefix can be invalidated.

## Known Limitations and Deferred Work

- **Rules are flat per group** — a principal's effective rules are the union of their groups' rules with deny winning. There is no rule ordering, priority, or per-user override; a user who needs a different answer joins a different group.
- **Patterns are exact or prefix-glob only** — no regular expressions or character classes. The vocabulary grows when a deployment shows a rule it cannot express, not before.
- **No password policy beyond length** — composition, rotation, reuse history, and breach-list checks belong to whichever surface creates users; the seam only refuses to store a password reversibly.
