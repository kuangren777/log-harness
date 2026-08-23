# Agent Note: The mail capability seam — one send, two providers, credentials by reference

Status: implemented

English | [中文](2026-08-23-mail-capability-seam.zh.md)

## Problem

Several product paths need the harness to send a message to a human: a sign-in code, a one-time code confirming a sensitive action, an operator notification. Each of them needs the same three things and none of them should own any of them — a transport that speaks SMTP, an SMTP password that never appears in a composition file, and a way for a test or a browser journey to read back what was sent without a mail server in the loop. Written per feature, each would ship its own nodemailer wiring, its own secret handling, and its own test fake, and the second one would have to guess whether it matched the first.

## Decision

**A [capability seam](../../../../docs/glossary.md#capability-seam) with the three roles in three packages.** `@deepseek-ai/dsh-mail` is the Service Definition: an abstract `MailService` on `ctx.mail` with one operation, `send(message: MailMessage): Promise<void>`, over a record of `to`, `subject`, `text`, and optional `html`. `@deepseek-ai/dsh-mail-smtp` and `@deepseek-ai/dsh-mail-file` are Service Providers. The Consumer role is empty for now: nothing mounts a mail provider, so no composition, snapshot, or shipped preset changes with this note.

**The seam owns no address grammar.** `to` reaches the provider as the caller typed it. `MailMessage` is a typed same-process interface, so the caller cannot hand over a non-string, and the component that decides whether an address is deliverable is the transport — an SMTP server's `RCPT TO`, or the file a test reads back. A regex here would only disagree with it. `from` is provider configuration rather than a message field, so one mounted provider sends as one identity and a consumer cannot compose a different sender.

**Templates stay with consumers.** Subject lines, bodies, locale choice, and recipient lookup belong to the feature that decides what to send; the seam moves finished content, so a template change never touches a transport.

**Credential references, never secrets.** The SMTP provider's `userRef` and `passwordRef` are the *names* of credential references, branded through `credentialRef` at load. Both resolve through `ctx.credentials` on every send, which is what makes a rotated password reach the next message without a restart; the resolved values live only in memory, and every diagnostic names the reference rather than the value. An unresolvable reference, and a configured reference with no credentials service mounted, both fail loud and name the reference. A reference outside the credential grammar, and a half-configured login with only one of the two references, fail earlier — at load, where the composition file carrying the mistake is the thing being read.

**One transport per resolved login.** Because resolution is per send, transport reuse is keyed on the resolved login: an unchanged login reuses the open nodemailer pool, and a rotation closes the retired transport before opening the next, so a withdrawn password never keeps a live authenticated connection. `ctx.effect` binds the live transport to the owning fiber; disposal closes it and refuses later sends, and a second disposal finds none.

**The mail-file line format is a test contract.** Each accepted message appends one compact JSON object plus `\n`: `ts` (ISO-8601 UTC acceptance instant), `to`, `subject`, `text`, and `html` only when the message carried one. Unit suites, keyless snapshots, and browser journeys parse those lines to recover what the harness sent — a 2FA code from a sign-in mail is the motivating read — so the field set changes only with its consumers. The mailbox is `0600` on create *and* on reopening a file an earlier run left readable, because a delivered message can carry a sign-in link; that is a security invariant, not a deployment choice. Writes are serialized through one queue, so line order is acceptance order, and disposal waits for accepted writes to settle before closing the handle.

## Why nodemailer

SMTP framing, STARTTLS negotiation, AUTH mechanism selection, MIME assembly for the `text`/`html` alternative, and header encoding are a protocol surface the repository would otherwise own outright, together with the real-server tests that keep it honest. nodemailer is maintained, MIT-0, and declares no runtime dependencies, so adopting it adds no transitive supply-chain surface ([dependency policy](../process/2026-07-26-dependencies-over-hand-rolling.md)). The provider depends on exactly two of its operations — `sendMail` and `close` — declared locally as `MailTransport`; that narrow declaration is also what lets the package suite drive every path against a recording double with no server, while `createSmtpTransport` remains the exported production factory and the constructor's default.

## Testing

Package suites reach per-file 100% coverage on all six sources. mail-file pins the JSON line format, appending to an existing mailbox, acceptance order under concurrent sends, `0600` on both create and reopen, parent-directory creation, the rejection when the path cannot be opened, and disposal (accepted write flushed, later send refused, second disposal inert). mail-smtp pins load-time reference branding and both configuration refusals, the transport options for authenticated and unauthenticated relays, reuse and rotation, both loud credential failures, disposal, and a logger exporter asserting that no resolved username or password appears in any record. `tests/mail-smtp.e2e.ts` delivers through a real server and self-skips unless `DSH_SMTP_TEST_HOST`, `_PORT`, `_USER`, and `_PASSWORD` are all set.

No snapshot changes: with no Consumer, nothing the model or a product user sees moves.

## Alternatives considered

**One package holding all three roles.** The seam has two providers on the first day and they evolve for unrelated reasons — an SMTP knob and a mailbox format have no shared release pressure — which is exactly the split the [capability-seam rationale](2026-06-13-capability-seams.md) asks for. A single package would also force every consumer of the definition to carry nodemailer.

**Literal `user` and `password` config fields.** They put a secret in a composition file, which is what the credential seam exists to prevent, and they freeze the value at load, so a rotation would need a restart.

**Resolving credentials once at startup.** It would allow one transport for the process lifetime and slightly simpler code, at the cost of the property the credential seam is built for: a changed credential reaching the next operation. Per-send resolution keeps that and pays only a map lookup when nothing changed.

**Hand-rolled SMTP.** Rejected on the same grounds the dependency policy states: it would add a protocol implementation and its real-server test burden to a repository whose subject is agent orchestration.

**A `transportFactory` config field for testability.** A knob that only tests set is not configurability, and it would let a composition file name an arbitrary factory. The factory is the third constructor parameter instead — unreachable from `cordis.yml`, defaulted to `createSmtpTransport`, and supplied directly by the suite that constructs the provider.

**Validating the recipient address in the seam.** Rejected under the same-process trust rule: the static interface already guarantees a string, and the transport is the boundary that decides deliverability. A second grammar would reject addresses a server accepts, and accept addresses it does not.

**Writing mail-file as a plain `appendFile` per message.** Reopening per send cannot restore the owner-only mode of a pre-existing mailbox without an extra stat, gives no ordering guarantee under concurrent sends, and leaves nothing for disposal to reach quiescence over.

## Consequences

The harness gains a mail capability with no consumer, which is deliberate: the seam and both providers are complete and tested, and the feature that first needs mail composes its own message and picks a provider without touching a transport. Nothing is mounted, so the cost of the addition to a running composition is zero.

`nodemailer` enters the dependency graph for `dsh-mail-smtp` alone, and `THIRD_PARTY_NOTICES.md` records it. The mail-file line format is now a contract two future audiences depend on; changing it means changing the suites and journeys that read mailboxes, which is the price of having one readable format instead of a fake per test.
