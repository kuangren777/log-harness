# camel-runtime — `fork_workspace`: the Dormice workspace forked through AgentENV microVMs

English | [中文](README.zh.md)

The `sci` profile keeps every user's workspace in one long-lived Dormice sandbox behind `ctx.e2b` ([`../../e2b/dormice/`](../../e2b/dormice/README.md)): idempotent by name, frozen between sessions, never deleted. That is the right owner for a workspace and the wrong engine for a parallel experiment — a gVisor container cannot be snapshotted with its processes and forked. AgentENV microVMs can, in about 80 ms per fork, but have no idempotent workspace and a default 15 s lifetime ([measurements](../../../../ClawsGO-System/09-Target-Architecture/A2-agentenv-vs-dormice-poc.md)). This package joins the two without moving the workspace: `fork_workspace` exports the Dormice directory once, seeds one microVM, snapshots it, resumes one microVM per variant from that snapshot, runs each variant's command, and writes what came back into the real workspace under `.sci/forks/<forkId>/<variant>/`. Every microVM and the snapshot are deleted when the call ends, whatever happened. Design: [`ClawsGO-System/09-Target-Architecture/A3-camel-runtime.md`](../../../../ClawsGO-System/09-Target-Architecture/A3-camel-runtime.md).

## Surfaces

| Surface | Where | Config |
|---|---|---|
| Tool `fork_workspace` | `ctx.tools.register()`, render intent `generic`, `collect` as its location | `forksDir`, `maxVariants` (both named in the description), `commandTimeoutSeconds`, `maxCommandTimeoutSeconds` |
| AgentENV client | native REST with `X-API-Key`; sandbox commands and files through the E2B SDK against the same endpoint | `endpoint`, `apiKey` (else `AENV_API_KEY`), `template`, `sandboxTimeoutSeconds` |
| Workspace transfer | `tar -czf … \| base64 -w0` over the command channel, `files.write` + `tar -xzf` on the other side | `exclude`, `maxWorkspaceBytes` |
| Event `sci/fork-completed` | appended on the calling agent's session, `ignorable: true` | — |

`inject = ['tools', 'e2b']`. The plugin belongs in the cluster (Swarm) preset only: the balanced tier has no fan-out, and `AENV_API_KEY` is injected only into cluster processes. The key is read by this process and never forwarded into either sandbox.

## One fork

1. `collect`, when given, is resolved inside `ctx.e2b.cwd`; a path that climbs out is refused before anything runs.
2. The workspace is archived once (`exclude` patterns applied; default `./.sci`, `./.dsh-e2b`, `*/node_modules`, `./.git`, `*.bin`) and refused over `maxWorkspaceBytes` (default 64 MiB).
3. One seed microVM starts from `template`, the archive is extracted at the same absolute path, and the microVM is snapshotted (memory and filesystem; ~1.4 s measured).
4. Up to `concurrency` variants at a time start from the snapshot and run `command` with `cwd` = the workspace path under `timeoutSeconds`. A non-zero exit is a result. A command over its budget reports exit `124`.
5. Per variant, `stdout.txt`, `stderr.txt`, and `exit-code` are written to `<forksDir>/<forkId>/<name>/`; with `collect`, that directory's contents (if it exists in the variant) are copied to `…/<name>/collect/`.
6. `finally`: every microVM is killed and the snapshot deleted. A failed deletion never masks the fork's own error.

Variants cannot see each other or the real workspace, and nothing a variant wrote outside `collect` survives.

## Model Experience

### Tool schema

#### What the model sees

The generated [`fork_workspace` schema](../../../docs/tool-catalog.md#deepseek-aidsh-camel-runtime): `variants[]` of `{ name, command }`, optional `collect` and `timeoutSeconds`. The description interpolates `forksDir` and `maxVariants`, the two facts the model must get right.

#### Token effect

Fixed schema cost on every request where the tool is visible; cluster preset only.

#### KV Cache effect

Static per deployment: the description changes only with `forksDir` or `maxVariants`.

### Tool-call history and result

#### What the model sees

One line per variant: `- <name>: exit <code>, results in <resultDir>`, followed by the last 4000 characters of stdout, and of stderr when the exit was non-zero. A refused request names the offending variant or field and the rule it broke.

#### Token effect

Bounded by `TAIL_CHARS` (4000) per stream per variant; the full output is on disk in the result directory, not in the transcript.

#### KV Cache effect

Appended once per call; unchanged afterwards.

## Known Limitations and Deferred Work

- **The archive travels through the command channel as base64.** `maxWorkspaceBytes` bounds it because stdout is buffered in memory on both ends; a workspace with large data files needs `exclude` patterns or a lower-level transfer (an envd file stream, or a shared object store) before the cap can be raised meaningfully.
- **No idempotent workspace on the AgentENV side by design.** Every fork rebuilds its seed from the archive; a warm per-user snapshot on AgentENV would cut the export and import but reintroduce a second durable copy of the workspace, which A3 rejects.
- **Snapshot memory includes whatever the seed had running.** The seed runs nothing but the import, so today the snapshot is a filesystem with an idle guest. Pre-warming (a running Python kernel, a loaded dataset) would need a `--start-cmd` on the template, not a change here.
- **The tool has no per-variant resource overrides.** CPU and memory come from the AgentENV template; AgentENV accepts overrides only for cold OCI starts, not for snapshot resumes.
