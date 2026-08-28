# Agent Note: fs-e2b bounds sandbox command spawns to four in flight

Status: proposed

English | [中文](2026-08-27-fs-e2b-command-concurrency-cap.zh.md)

## Problem

The first production deployment of the `sci` profile against a Dormice (gVisor) sandbox crash-looped on restart. `dsh-sci-skills` re-syncs its skill tree on start; against an already-populated sandbox that walk resolves every file, and `fs-e2b` runs one `realpath` spawn per `resolve()` plus one `stat` spawn per entry on a backend without extended attributes. A 223-file tree under one `Promise.all` reached 209 `process.Process/Start` requests per second, and the gVisor sentry crashed: every in-flight operation failed with `containerManager.WaitPID: EOF`, the container exited, and the harness's fail-loud boot turned it into a restart loop that hammered the daemon hard enough to corrupt its HTTP replies (`ERR_HTTP_HEADERS_SENT`).

The first deployment had not tripped it because a fresh sandbox takes the pure write path (envd file API, no spawn per entry); the walk-and-compare path only runs once the tree already exists. Diagnostic evidence: the daemon journal recorded 4666 `process.Process/Start` in 40 minutes at a 209/s peak; the crash signature was container exit 2 with `OOMKilled=false` and no kernel-side trace; a fresh sandbox, a reverted profile patch, and a daemon restart all still crashed, while a bare `acquireSandbox` with no file traffic stayed up.

## Proposal

`E2BFileSystem` routes every `sandbox.commands.run` through a private four-slot semaphore (`withCommandSlot`). File reads and writes go through envd's file API, not a spawn, and stay unthrottled.

The cap lives in the provider, not in callers, because any caller may legally fan out (`sci-skills` sync is one; a parallel tool loop is another) and the crash is a property of the backend runtime. It is a constant, not config: spawn-concurrency tolerance is a stability invariant of the gVisor runtime the provider targets, and on a backend that could take more the cap costs only latency on the spawn-backed operations (resolve, inode stat, and the chmod/ln steps of the atomic-write path).

## Acceptance criteria

- A `Promise.all` of 30 `resolve()` calls against a mock whose commands pause in flight observes a command-concurrency peak of at most four and still resolves every path (`tests/filesystem.spec.ts`).
- The deployed `sci` profile boots against an already-populated sandbox without the sentry crash: the harness reaches HTTP 200 and the sandbox container stays running through the skill-tree sync.

## Risks

- Spawn-backed operations serialize behind four slots, so a pathological fan-out completes slower instead of failing; the slots are held only for the spawn itself, which keeps the added latency per operation to one command round trip.
- The constant encodes an observed gVisor tolerance rather than a documented limit; if a future backend crashes below four concurrent spawns, the cap must move, and the Agent Note plus the `withCommandSlot` JSDoc are where that fact is recorded.

## Alternatives considered

- Batching the per-entry inode `stat` into one spawn per directory: narrower — it leaves `canonicalPath` (one spawn per `resolve()`) unbounded, and the 200-wide resolve fan-out alone reproduced the crash.
- Throttling in `sci-skills`' sync: wrong owner — every other fan-out caller (parallel tool loops, future consumers) would need the same fix, and the crash is a property of the backend the provider fronts.
- A config field for the cap: rejected as a tunable without a deployment that needs it; the value is a stability invariant of the targeted runtime, not a per-deployment choice.
