# @deepseek-ai/dsh-dormice

English | [中文](README.zh.md)

Service Provider for the [E2B sandbox seam](../e2b/README.md) backed by a self-hosted [Dormice](https://github.com/BitMiracle-AI/Dormice) daemon. It replaces the disposable-sandbox assumption of [`dsh-e2b-cloud`](../e2b-cloud/README.md) with one durable sandbox per user: acquisition is addressed by key, so the same key always returns the same sandbox with its filesystem intact, and disposal leaves it running for the daemon to freeze. The deployment procedure and the source-verified daemon facts this package is built against live in the studied platform's plan (`ClawsGO-System/11-Deployment-Plan/01-dormice-install.md`).

## Configuration

```yaml
- id: e2b
  name: '@deepseek-ai/dsh-dormice'
  config:
    endpoint: http://127.0.0.1:3676
    userKey: !!js `sci:${process.env.DSH_SCI_USER_ID}`
    image: sci-base
    cwd: /home/user/sci
    policy:
      freezeAfterSeconds: 600
      stopAfterSeconds: 604800
    acquireTimeoutMs: 120000

- id: subprocess-e2b
  name: '@deepseek-ai/dsh-subprocess-e2b'

- id: fs-e2b
  name: '@deepseek-ai/dsh-fs-e2b'
```

| Field | Default | Meaning |
|---|---|---|
| `endpoint` | `http://127.0.0.1:3676` | Base URL of the daemon; a trailing slash is dropped |
| `token` | `DORMICE_API_TOKEN` | Daemon API token. Used for the native `Authorization: Bearer` header and, prefixed with `e2b_`, as the SDK's `X-API-KEY`. It is never forwarded into the sandbox |
| `userKey` | required | Sandbox address. `sci:<userId>` is the convention; the native API accepts any 1–128 character string |
| `image` | daemon base image | A template registered with `dor template add`; an unknown name is a load-time failure from the daemon |
| `cwd` | `/home/user/sci` | Shared remote working directory, created before adapters receive the sandbox |
| `policy` | daemon defaults | Lifecycle override. Omitted entirely, the request carries no `policy` at all |
| `policy.freezeAfterSeconds` | daemon default | Idle seconds until an active sandbox freezes |
| `policy.stopAfterSeconds` | daemon default | Idle seconds until a frozen sandbox stops. `null` parks it frozen forever |
| `policy.archiveAfterSeconds` | daemon default | Idle seconds until a stopped sandbox archives. `null` never archives; a number requires a non-null `stopAfterSeconds` |
| `acquireTimeoutMs` | `120000` | Deadline for the whole acquisition, archive restore included |
| `restorePollIntervalMs` | `1000` | Delay between acquire polls while an archived sandbox is restored |

Every `policy` threshold is a per-sandbox override of one daemon default, and an omitted threshold is not sent, so the daemon's own value applies — a stock daemon freezes after 600 s, stops after 3 days, and never archives. The daemon validates the merged result and answers an impossible combination with a 400 on the first acquire.

Misconfiguration fails at load: a missing token or `userKey`, a non-URL `endpoint`, a non-absolute `cwd`, a non-positive timeout, or an `archiveAfterSeconds` against an explicitly `null` `stopAfterSeconds`.

## Acquisition

`getSandbox()` acquires lazily and single-flight: the first call runs the acquisition, concurrent callers await that one attempt, and a failed attempt is discarded so a transient daemon failure does not poison the service.

One acquisition is two steps against the daemon:

1. `POST <endpoint>/acquireSandbox` with `Authorization: Bearer <token>` and `{ name: userKey, policy?, template? }`. The verb is idempotent — no sandbox creates one, frozen wakes, stopped rebuilds, archived restores — and the same name always converges on the same sandbox id. `policy` and `image` apply only when this acquire creates the sandbox; an invalid value is still rejected. A `restoring` answer is polled until `ready` or the deadline.
2. `Sandbox.connect(id, { apiKey: 'e2b_<token>', apiUrl: <endpoint>/e2b/api, sandboxUrl: <endpoint>/e2b/envd })` with the official `e2b` SDK, which the daemon serves on its compatibility prefixes.

The native verb, not the compatibility surface's idempotent `metadata.name` extension, carries the acquisition for two reasons: the E2B route restricts the name to `[a-zA-Z0-9._-]{1,64}`, which rejects a `sci:<userId>` key, and it ignores any per-sandbox lifecycle policy in the request.

`getSandbox()` resolves only after `cwd` and the reserved `cwd/.dsh-e2b` adapter-state directory exist, the reserved path is verified to be a real directory rather than a symlink or another file type, and it is set to mode `0700`.

## Disposal

Disposal refuses new handle acquisition and aborts an acquisition already in flight, so no restore poll survives the fiber. It does nothing else. It never calls `kill()`: on this daemon a kill destroys the sandbox and discards the user's whole workspace. The sandbox stays as the daemon's lifecycle policy leaves it — frozen after the daemon's idle threshold, woken in place by the next acquire under the same key.

## Model Experience

Indirectly, through the `fs-e2b` and `subprocess-e2b` adapters and their tool consumers, which own every rendered effect; this sandbox provider registers no model-visible context of its own.

#### KV Cache effect

No direct invalidation; this package does not contribute request tokens.

## Known Limitations and Deferred Work

- **No session event marks an acquisition** — `sci-audit` cannot yet distinguish a created sandbox from a woken one, because this runtime owner holds no Agent or Session to log against.
- **A hung daemon surfaces as the platform `TimeoutError`** — only the archive-restore path reports the deadline in this package's own vocabulary.
- **The sandbox is never garbage-collected from here** — reclaiming a user's sandbox is an operator action (`dor sandbox destroy`), so an abandoned key keeps its disk until the daemon's archive policy or an operator removes it.
- **No cross-machine placement** — `endpoint` names one daemon, and `Sandbox` records carry that daemon's loopback address, so a sharded fleet needs a routing layer this package does not have.
