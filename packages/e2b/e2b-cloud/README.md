# @deepseek-ai/dsh-e2b-cloud

English | [中文](README.zh.md)

Service Provider for the [E2B sandbox seam](../e2b/README.md) backed by hosted E2B Cloud. It creates one short-lived sandbox at load, prepares the shared working and runtime directories, hands the single SDK handle to the filesystem and subprocess adapters, and deletes the sandbox at timeout or disposal. The [family map](../README.md) lists the opt-in composition; [`dsh-dormice`](../dormice/README.md) is the self-hosted alternative provider.

## Configuration

```yaml
- id: e2b
  name: '@deepseek-ai/dsh-e2b-cloud'
  config:
    cwd: /home/user/workspace
    timeoutMs: 300000

- id: subprocess-e2b
  name: '@deepseek-ai/dsh-subprocess-e2b'

- id: fs-e2b
  name: '@deepseek-ai/dsh-fs-e2b'
```

`apiKey` is optional and otherwise reads `E2B_API_KEY`; the key configures the host SDK connection and is never installed in the sandbox. `cwd` defaults to `/home/user/workspace` and must be an absolute POSIX path. `timeoutMs` defaults to five minutes and controls the sandbox lifetime; expiry deletes the sandbox.

## Lifecycle and ownership

Construction starts one sandbox creation. Before resolving `getSandbox()`, the service creates `cwd` and the private `cwd/.dsh-e2b` adapter-state directory, verifies that the reserved path is a real directory rather than a symlink or another file type, then sets it to mode `0700`. Each adapter-internal E2B command shell receives a fresh randomized root-level `HOME`, so the SDK's fixed login shell does not resolve profile files from the mutable user home before the control command.

Disposal first prevents new handle acquisition, then awaits setup and deletes the sandbox. A `SandboxNotFoundError` means expiry or another owner already deleted it and is accepted as quiescence. Initial directory setup failure makes one deletion attempt; the configured E2B timeout bounds a second failure. Adapter plugins must load after this provider and dispose before it.

## Model Experience

Indirectly, through the `fs-e2b` and `subprocess-e2b` adapters and their tool consumers, which own every rendered effect; this sandbox provider registers no model-visible context of its own.

#### KV Cache effect

No direct invalidation; this package does not contribute request tokens.

## Known Limitations and Deferred Work

- **Sandbox state is ephemeral** — disposal and timeout delete the sandbox; reconnect, pause/leave retention, templates, volumes, and snapshots are outside this POC.
- **No deployment platform is configured** — network policy, host-workspace synchronization, and sandbox discovery are outside this POC.
- **The base image is E2B's default** — template selection is not a config field, so a deployment needing preinstalled tooling has no supported path here yet.
