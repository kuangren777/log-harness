# Agent Note: The first administrator is created by a local CLI, not over the network

Status: implemented

English | [中文](2026-08-23-auth-bootstrap-cli.zh.md)

## Problem

The [auth capability](../architecture/2026-08-23-auth-capability-design.md) makes administrator rights membership in one builtin group, and a fresh `auth.db` has that group with no members. Nothing in the deployment can grant the first membership: every administrative operation the seam offers requires an administrator principal, so a new multi-user installation is inert until someone becomes one.

The usual answer — a first-run registration page that grants admin rights to whoever reaches it first — is a race between the operator and the internet. Whoever loads the page first owns the deployment, and the window stays open for as long as the store has no administrator. Shipping a seeded default account instead only moves the problem to a published password.

## Decision

`dsh auth bootstrap --email <address>` creates the first administrator, and it exists only as a launcher subcommand. It opens `<harness home>/auth.db` through `@deepseek-ai/dsh-auth-sqlite` directly: no Cordis application boots, no service is mounted, and no Typert method is generated, so there is no code path by which a network peer reaches it. Write access to the harness home is what stands in for authorization, which is precisely the right that distinguishes the operator from a remote caller. The alternative is a permission check that has to be correct; this is an operation that is not there to check.

[`apps/cli/src/auth-cli.ts`](../../../../apps/cli/src/auth-cli.ts) owns the action, [`apps/cli/src/args.ts`](../../../../apps/cli/src/args.ts) owns the grammar, and `--home <path>` overrides `$DSH_HOME` through the shared `resolveDshHome`, so a test and an operator address the same store the same way.

### Refusing once an administrator exists

The command reads the builtin group's membership first and refuses with a nonzero exit when it is not empty, before it looks at the address, the password, or anything else. This is the invariant that keeps the command from being an escalation path: it can only ever run against a deployment that has nobody to escalate against. It is not a convenience check that a later flag can waive — there is no `--force`, because the operation `--force` would name is "add an administrator", which the authenticated administrative surface already owns.

### Password sources and their precedence

`DSH_BOOTSTRAP_PASSWORD` wins whenever it is defined; otherwise the command prompts on a terminal with readline's output directed at a discarding sink, so nothing typed is echoed and no line is replayed. Without either source it refuses and names both, rather than reading a password from argv where it would land in shell history and in every process listing on the host. A defined-but-empty variable is used rather than treated as unset: an empty value is a broken deployment script, and falling through to a prompt would hide the breakage behind a command that appears to work. The minimum length is a fixed 12 characters, not a configurable one, because the deployment most likely to lower it is the one least able to afford a shorter password.

The password never reaches output or storage. It is hashed by `createUser` before insertion, no refusal message quotes it, and the length refusal states only the length.

### Creating versus promoting

An unknown address creates the account, adds the membership, and leaves `email_verified_at` unset so the first login owns verification. An address that already has an account is promoted into the group with its password untouched, and no password is read at all on that path. Refusing instead would strand the deployment whose only account was created some other way: it has no administrator and no way to reach one. Rewriting the account's password would turn a recovery command into an account takeover, so promotion changes exactly one thing — the membership — and the success line says the password is unchanged.

The builtin group is materialized by the provider's own schema, so this command never creates it. When it is missing, the store's `unknown-subject` refusal surfaces as a loud failure rather than being papered over with a group this command invented, which would carry the wrong id and `builtin=0`.

## Alternatives considered

**A first-run web registration page.** Rejected because the deployment is reachable before the operator finishes configuring it, and the page grants full rights to whoever arrives first. The race has no safe duration.

**A seeded default administrator with a known password.** Rejected because the password is published the moment the release is, and an installation that never rotates it ships an open account.

**A one-time bootstrap token printed at first boot.** Rejected as strictly weaker than the file-access check it would replace: the token has to be printed somewhere, read from somewhere, and expired somehow, and each of those is a new way to leak it. Local write access to `auth.db` is already necessary and already sufficient.

**An RPC method behind a "no administrator exists yet" guard.** Rejected because the guard is the whole security of the operation, and it would live on a surface whose entire job is accepting anonymous connections. An operation that cannot be reached cannot have its guard bypassed.

**Taking the password as a `--password` flag.** Rejected because argv is visible in `ps` output to every local account and is written to shell history. The environment variable is not much better, but it is the interface a deployment script needs, and it is opt-in.

**Refusing when the address already exists.** Rejected because it strands a store that has accounts but no administrator, which is exactly the state this command exists to repair.

## Testing

[`apps/cli/tests/auth-cli.spec.ts`](../../../../apps/cli/tests/auth-cli.spec.ts) drives the action against a temporary harness home and reads the resulting SQLite file directly: creation writes the user, the membership, and the `auth.bootstrap` audit record with the address unverified; a second run refuses nonzero and leaves a byte-identical dump of `users`, `memberships`, and `audit_log`; each password source, the missing-source refusal, the length refusal, and the malformed-address refusals are separate cases; and one case scans both captured streams and the whole database for the plaintext. [`apps/cli/tests/args.spec.ts`](../../../../apps/cli/tests/args.spec.ts) covers the grammar, including that `auth` and `auth bootstrap` keep their own `-h` while the root launcher hands `-h` to the booted app.

## Consequences

A new multi-user deployment has one bootstrap procedure, it requires shell access to the host, and it cannot be performed remotely at any point in the deployment's life. An operator who loses every administrator account recovers by promoting an existing account with the same command, without a password reset. The cost is that bootstrap is unavailable to a hosted control panel that never gets a shell, and that `dsh` now depends on the SQLite auth provider — the launcher links the store it previously had no reason to know about.
