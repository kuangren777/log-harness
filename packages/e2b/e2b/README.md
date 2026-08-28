# @deepseek-ai/dsh-e2b

English | [中文](README.zh.md)

Service Definition for the E2B sandbox seam. Filesystem and subprocess adapters inject `ctx.e2b` and await its single SDK handle, so they inhabit the same remote Linux working tree and process world regardless of which provider supplies the sandbox. The package pins `e2b@2.29.1` and re-exports the SDK surface adapters need; the [family map](../README.md) lists the providers and the opt-in composition.

This package is not loadable on its own — it declares the seam. Mount one provider: [`dsh-e2b-cloud`](../e2b-cloud/README.md) for hosted E2B Cloud sandboxes, or [`dsh-dormice`](../dormice/README.md) for a self-hosted Dormice pool.

## What the seam owns

`E2BRuntime` is an abstract Cordis service registered under the key `e2b`. Its constructor takes the shared absolute working directory, rejects a non-absolute Linux path, and derives the two paths every adapter reads:

- `cwd` — the shared remote working directory.
- `runtimeRoot` — `cwd/.dsh-e2b`, reserved for adapter-owned process and terminal state. The relative name is fixed (`E2B_RUNTIME_DIRECTORY`) so state one provider's sandbox writes is where the adapters look for it.

Providers implement one method, `getSandbox()`, which resolves the shared live SDK handle after both directories exist. Repeat calls await one acquisition and return the same handle; acquisition failure reaches every caller; disposal first refuses new acquisition, and whether it also deletes the sandbox is the provider's lifetime policy.

Two helpers are exported because both adapters need them against the SDK's hard-coded `/bin/bash -l -c` layer:

- `quoteE2BShellArg(value)` — turns one opaque argument into a single shell word with no interpolation.
- `e2bControlEnvs(overrides)` — gives each adapter-internal command a fresh randomized root-level `HOME`, so the login shell cannot resolve profile files from the mutable user home before the control command.

## Configuration

None. Every deployment-varying value (credentials, sandbox lifetime, working directory, acquisition policy) is a provider `Config` field.

## Model Experience

None, as this Service Definition registers no model-visible context; providers, adapters, and their consumers own any rendered effects.

#### KV Cache effect

No direct invalidation; this package does not contribute request tokens.

## Known Limitations and Deferred Work

- **This is not a whole-harness runtime** — Cordis services, agent/session state, session logs, LLM requests, skills, and SDK-side buffers stay in the host process.
- **`cwd` is a resolution convention, not containment** — adapters and commands can address other sandbox paths, and network access retains the sandbox image's policy.
- **The seam pins one SDK version** — providers reach the E2B SDK through this package's re-exports, so a provider cannot run against a different `e2b` release without moving the pin here.
