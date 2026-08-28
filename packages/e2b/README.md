# e2b/ — E2B remote runtime family

English | [中文](README.zh.md)

An experimental provider-composition POC that places one filesystem/process execution world in an E2B Linux sandbox. E2B supplies sandbox lifecycle, the two fundamental OS adapters, and the GUI host's directory picking over that same sandbox; provider-neutral consumers build higher capabilities above them. Exactly one sandbox provider mounts per context.

| Package | ctx key | Role |
|---|---|---|
| [`e2b`](e2b/README.md) (`@deepseek-ai/dsh-e2b`) | `ctx.e2b` | Define the sandbox seam: the shared working/runtime directories, the one awaited SDK handle, and the SDK login-shell helpers |
| [`e2b-cloud`](e2b-cloud/README.md) (`@deepseek-ai/dsh-e2b-cloud`) | `ctx.e2b` | Provide the sandbox from hosted E2B Cloud: create one, prepare its directories, and delete it on timeout or disposal |
| [`dormice`](dormice/README.md) (`@deepseek-ai/dsh-dormice`) | `ctx.e2b` | Provide the sandbox from a self-hosted Dormice daemon: acquire one per user key, keep it across sessions, and never delete it |
| [`fs-e2b`](fs-e2b/README.md) (`@deepseek-ai/dsh-fs-e2b`) | `ctx.fs` | Implement the filesystem seam over E2B Filesystem APIs |
| [`subprocess-e2b`](subprocess-e2b/README.md) (`@deepseek-ai/dsh-subprocess-e2b`) | `ctx.subprocess` | Implement executable lookup, managed process groups and stdio, remote spill files, and terminal sessions over E2B Commands and PTY APIs |
| [`directory-picker-e2b`](directory-picker-e2b/README.md) (`@deepseek-ai/dsh-host-directory-picker-e2b`) | `ctx.directoryPicker` | Implement the GUI host's `browse` directory picking inside the sandbox, so the workspace directory an operator selects is one the sandbox can enter |

The existing [`dsh-bash-local`](../shell/bash-local/README.md), [`dsh-terminal-bash`](../terminal/terminal-bash/README.md), and [`dsh-lsp-stdio`](../lsp/lsp-stdio/README.md) need no E2B-specific forks. They delegate every execution-world operation to `ctx.fs` and `ctx.subprocess`, so mounting the two E2B adapters places their mutable work in the same sandbox.

This boundary does not move the harness process, Cordis objects, model calls, agent/session state, session persistence, skills, higher-level protocol state, or E2B SDK buffers. The [portable execution-world decision](../../.agents/notes/implemented/architecture/2026-07-28-portable-execution-world-consumers.md) owns both the generic composition and this POC boundary.
