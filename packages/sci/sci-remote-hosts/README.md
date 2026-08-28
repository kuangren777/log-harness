# sci-remote-hosts — the managed `~/.ssh/config` block of the `sci` profile

English | [中文](README.zh.md)

Replaces the studied platform's *Agent dialog → SSH* form and the `clawsgo-remote-hosts` skill it fed (`ClawsGO-System/01-Skills/_raw-skills/clawsgo-remote-hosts/SKILL.md`, plan in `ClawsGO-System/09-Target-Architecture/07-skills-plan.md`). Two things changed. That platform rewrote the whole file on every save, so the skill had to teach users that anything hand-written inside the markers was normalised away and that their own `ProxyJump` chains belonged elsewhere; here the guarantee runs both ways — inside the markers the plugin is authoritative, outside them every byte is carried over untouched. And the private keys now go through the `ctx.credentials` seam instead of existing only as files nothing owns, so what a sandbox was authorized to reach is a record with a scope, not a directory listing.

## Configuration

```yaml
- name: '@deepseek-ai/dsh-sci-remote-hosts'
  config:
    sshConfigPath: /home/user/.ssh/config
    identityDir: /home/user/.ssh
    connectTimeoutSeconds: 10
    serverAliveIntervalSeconds: 30
```

| Field | Default | Meaning |
|---|---|---|
| `sshConfigPath` | required | Absolute path of the ssh client configuration inside the sandbox |
| `identityDir` | required | Absolute directory the per-alias private keys are written to |
| `connectTimeoutSeconds` | `10` | `ConnectTimeout` of every rendered entry |
| `serverAliveIntervalSeconds` | `30` | `ServerAliveInterval` of every rendered entry |

Both paths are required and neither has a default: the home layout differs per sandbox image, and a guessed path would write a block no `ssh` invocation ever reads. A relative value fails the load.

## The managed block

```
# >>> sci remote hosts >>>
Host gpu-lab
    HostName gpu.example.com
    User ubuntu
    IdentityFile /home/user/.ssh/sci-gpu-lab
    IdentitiesOnly yes
    BatchMode yes
    ConnectTimeout 10
    ServerAliveInterval 30
    StrictHostKeyChecking accept-new
# <<< sci remote hosts <<<
```

The option set is the promise the skill makes to the model — non-interactive `BatchMode`, no host-key prompt, a ten-second connect timeout, keep-alives — so that the model never needs `-o` overrides of its own. `IdentitiesOnly` is what keeps that promise honest: without it ssh offers every agent identity first and can spend the server's whole `MaxAuthTries` budget before reaching the entry's own key, which turns a working host into an apparent authorization failure. `Port` is rendered only for an entry that declared one, because a lab machine reached through a port forward — the remedy the skill names for an unreachable box — rarely answers on 22.

`renderManagedBlock(hosts, options)` emits entries in alias order, so re-registering an unchanged roster reproduces the same bytes. A host the user switched off keeps its entry with every line commented out rather than being deleted, which is exactly the state the skill tells the model not to use and not to uncomment.

`spliceManagedBlock(existing, block)` replaces the region between the markers and copies everything else through unchanged. The single exception is a file whose last line has no newline: that line is closed before the block is appended, because otherwise the user's last entry and the start marker would run together. A file carrying one marker without the other is refused rather than repaired — with the region's end unknown, rewriting would either duplicate the block or swallow every entry below it.

## Registration

`sci.hosts.list`, `upsert`, `remove`, and `toggle` are Typert Remote endpoints under the `sci.hosts` namespace. The config file is the only state: `list` parses the block back rather than consulting a cache, so the roster the RPC reports and the hosts `ssh` can reach are the same fact.

`upsert` commits in custody order — the credential record, then the key file the entry will point at, then the entry — so an interruption leaves at worst a key nothing references, never an entry naming a key that was never written. `remove` reverses it: the entry goes first, then the key file is overwritten with nothing, then the record is deleted.

An alias must match `^[a-z][a-z0-9-]*$`, which is the credential seam's own key-segment grammar, and `hostName` and `user` must each be a single whitespace-free token. That last rule is a wire-boundary check, not tidiness: a value carrying a newline would write extra option lines into a block that is read back as the truth about what the model may connect to.

Key material reaches the credential seam and the key file and nothing else. It is never written into the config file, never returned by an endpoint — `list` reports only the path of the key an entry uses — and never appended to a session log.

## Failure diagnosis

`classifySshFailure(verboseOutput)` turns one `ssh -v` transcript into a ranked cause and a remedy sentence, and ships as the `sci-ssh-doctor <alias>` command for the sandbox image. The skill already knew the ranking — a public key missing from the server's `authorized_keys`, a machine the sandbox's network cannot reach, a wrong username — but left the reading of `ssh -v` to a model that had never seen that server.

| Cause | Decided by |
|---|---|
| `host-unreachable` | a refused, timed-out, or unroutable connection, or a name that does not resolve |
| `key-unusable` | ssh refusing the key file itself: absent, unreadable, or wider than mode `0600` |
| `wrong-username` | the server naming the account as invalid or not permitted |
| `key-not-authorized` | `Permission denied (publickey)` after the key was offered |
| `unclassified` | nothing conclusive in the transcript |

The rules are applied in that order, which is by how conclusive the evidence is rather than by how likely the cause is: a connection that never reached the server cannot have failed authentication, and a key ssh refused to load was never offered, so both are decided before the `Permission denied (publickey)` line that all of these failures also print. `key-unusable` is separated from the skill's three causes because the same skill notes that a private key must be `chmod 600` or ssh refuses it — reporting that as a missing `authorized_keys` entry would send the user to fix a server that is fine.

## Model Experience

Indirectly, through the `ssh` and `rsync` command lines the model runs inside the sandbox and the skill that teaches them; this package registers no prompt, tool, or model-visible context of its own.

#### KV Cache effect

None. Nothing this package writes reaches a model request: the managed block is read by `ssh` inside the sandbox, not by prompt assembly, so no prefix it owns can move, and registering, switching, or removing a host invalidates no cached prefix.

## Known Limitations and Deferred Work

- **The key file's mode belongs to the sandbox image.** `ctx.fs` has no `chmod` verb, so this package writes the key with whatever mode the backend chose. ssh refuses a private key that is group- or world-readable, so the image must create `identityDir` such that files land at `0600` — otherwise every host fails with `key-unusable` on first use.
- **A removed key is emptied, not deleted.** `ctx.fs` has no unlink verb either. Removal overwrites the file with nothing, which does destroy the material, but leaves a zero-byte `sci-<alias>` behind.
- **No session event records a registration.** The RPC is a configuration act with no session and no Agent behind it, so `sci-audit` cannot show when a host became reachable; an event would have no session to belong to.
- **The generated Remote client is not registered.** `pnpm run build` emits `lib/typert.host.*` and `lib/typert.remote-client.*` from the `./typert` and `./remote` exports, but adding this package to `packages/api/remotes/src/client/index.ts` is a cross-package change the profile assembly owns.
- **`sci-ssh-doctor` ships as a Node command.** The sandbox's own `sci` CLI is a Python port, so until it carries `classifySshFailure` against the same fixture table, an image without Node has the classifier only through this package's bin.
