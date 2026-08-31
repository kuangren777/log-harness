# camel-runtime — persistent project variants: the Dormice workspace copied into AgentENV microVMs

English | [中文](README.zh.md)

The `sci` profile keeps every user's workspace in one long-lived Dormice sandbox behind `ctx.e2b` ([`../../e2b/dormice/`](../../e2b/dormice/README.md)): idempotent by name, frozen between sessions, never deleted. That is the right owner for a workspace and the wrong engine for parallel experiments — a gVisor container cannot be snapshotted with its processes and forked, and every subagent shares its one filesystem. AgentENV microVMs can be paused, resumed, snapshotted, and forked in well under a second ([measurements](../../../../ClawsGO-System/09-Target-Architecture/A2-agentenv-vs-dormice-poc.md)), but have no idempotent workspace of their own. This package joins the two without moving the workspace: a **variant** is a named slot holding an AgentENV microVM with a copy of one project directory. The model creates a variant, runs commands in it, copies what it wants back, and deletes it; the workspace's own files are never touched by a variant. Slots are bounded per workspace (`maxVariants`, a plan-dependent number the deployment sets per VM), and a full workspace must delete a variant before creating another. Design: [`ClawsGO-System/09-Target-Architecture/A3-camel-runtime.md`](../../../../ClawsGO-System/09-Target-Architecture/A3-camel-runtime.md).

## Surfaces

| Surface | Where | Config |
|---|---|---|
| Tools `create_variant`, `run_in_variant`, `collect_variant`, `delete_variant`, `list_variants` | `ctx.tools.register()`, render intent `generic`; the project or collected path is the call's location | `maxVariants` (named in `create_variant`'s description), `variantsDir`, `commandTimeoutSeconds`, `maxCommandTimeoutSeconds` |
| Variant registry | `<variantsDir>/registry.json` in the workspace, read and written through `ctx.e2b`; one in-process lock serializes mutations | `variantsDir` (default `.sci/variants`) |
| AgentENV client | native REST with `X-API-Key`; sandbox commands and files through the E2B SDK against the same endpoint | `endpoint`, `apiKey` (else `AENV_API_KEY`), `template`, `sandboxTimeoutSeconds` |
| Project transfer | `tar -czf … \| base64 -w0` over the command channel, `files.write` + `tar -xzf` on the other side | `exclude`, `maxProjectBytes` |
| Events `sci/variant-created`, `sci/variant-deleted`, `sci/variant-run` | appended on the calling agent's session, `ignorable: true` | — |

`inject = ['tools', 'e2b']`. The plugin belongs in the cluster (Swarm) preset only: the balanced tier has no fan-out, and `AENV_API_KEY` is injected only into cluster processes. The shipped cluster preset gates the row on that variable (`disabled: !!js process.env.AENV_API_KEY === undefined`) and reads the cap from `AENV_MAX_VARIANTS`, so a deployment without an AgentENV server simply has no variant tools and a deployment with one sets the cap per plan; once the key is set, any other misconfiguration fails at load. The key is read by this process and never forwarded into either sandbox.

## A variant's life

1. `create_variant {name, project}`: the slot name must match `^[a-z0-9][a-z0-9-]{0,63}$` and be free; the registry must hold fewer than `maxVariants` slots (otherwise the refusal names the slots in use and `delete_variant`); `project` is resolved inside `ctx.e2b.cwd` and must exist. The project directory is archived (`exclude` applied, refused over `maxProjectBytes`, default 64 MiB), a microVM starts from `template`, and the archive is extracted at the same absolute path. With `from: <variant>`, no archive is made: the sibling is resumed, snapshotted (files, processes, memory), and the new microVM starts from that snapshot; the snapshot is deleted with the variant.
2. `run_in_variant {name, command, timeoutSeconds?}`: the microVM is resumed if paused (`POST /sandboxes/{id}/connect`, which also renews the idle TTL) and the command runs from the project directory. A non-zero exit is a result; a command over its budget reports exit `124`. Only the last 4000 characters of each stream reach the model.
3. `collect_variant {name, path?}`: a project-relative directory of the variant (default the whole project) is archived and extracted into `<variantsDir>/<name>/collect/<path>` in the workspace. Existing collected files are overwritten; the real project files are not touched.
4. Idle for `sandboxTimeoutSeconds` (default 30 min), AgentENV pauses the microVM (memory to disk, ~50 ms to resume). `list_variants` reports each slot as `running`, `paused`, or `missing` — the last when AgentENV no longer has the sandbox (restart, eviction); a missing variant must be deleted and created again.
5. `delete_variant {name}`: the microVM is killed, a fork's snapshot deleted, the slot freed. Collected files stay.

The registry is the slot table: a new harness process finds the variants the last one left, and a corrupt registry file is refused rather than read as empty so no slot gets a second sandbox.

## Model Experience

### Tool schema

#### What the model sees

The generated schemas of the five tools ([tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-camel-runtime)). `create_variant`'s description interpolates `maxVariants`, the fact the model must plan around; every description says what happens to files (nothing reaches the workspace until collected).

#### Token effect

Five fixed schemas on every request where the tools are visible; cluster preset only.

#### KV Cache effect

Static per deployment: the descriptions change only with `maxVariants` or `variantsDir`.

### Tool-call history and result

#### What the model sees

One line per outcome: `variant a created, copied from projects/p1; 1/8 slots used`; `variant a: exit 0 (412 ms)` followed by the stdout tail and, on failure, the stderr tail; `collected 3 files from variant a:out into /home/user/sci/.sci/variants/a/collect/out`; `variant a deleted; 0/8 slots used`; a listing of `- <name>: <project>, <state>, last used <time>`. A refused call names the slot or field and the rule it broke, including the delete-first remedy when the cap is reached.

#### Token effect

Bounded by `TAIL_CHARS` (4000) per stream per run; the full output stays in the variant, not in the transcript, until collected.

#### KV Cache effect

Appended once per call; unchanged afterwards.

## Known Limitations and Deferred Work

- **The archive travels through the command channel as base64.** `maxProjectBytes` bounds it because stdout is buffered in memory on both ends; a project with large data files needs `exclude` patterns or a lower-level transfer (an envd file stream, or a shared object store) before the cap can be raised meaningfully.
- **A variant is one project, not the workspace.** Commands in a variant see only the copied project directory; a project that reads sibling projects or the workspace root at runtime needs those inputs copied in by hand (`run_in_variant` with `mkdir`/`cat` from collected files) or the project restructured.
- **`missing` is detected, not repaired.** AgentENV keeps paused sandboxes across its own restarts, but eviction or an operator deleting the server's data leaves a slot whose sandbox is gone; the model is told to delete and recreate. Automatic recreation from the last collected state is deferred until a real loss shows what to restore.
- **The cap counts slots, not resources.** `maxVariants` bounds how many microVMs a workspace may hold; CPU and memory per microVM come from the AgentENV template, and AgentENV accepts overrides only for cold OCI starts, not for template or snapshot resumes.
