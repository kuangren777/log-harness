# dsh-sci-workspace

English | [中文](README.zh.md)

Replaces the ClawsGO filesystem contract and the bundle skills' ownership prohibitions, which were prompt prose only (archived at `ClawsGO-System/00-Architecture/02-filesystem-contract.md` and `ClawsGO-System/01-Skills/_raw-skills/`, outside this repository). There, `workspace/` being the only delivery area, `versions/` being append-only, `papers/` holding no foreign PDFs, and `rm -rf` never touching a bundle were sentences the model was asked to honour; the only enforced rule was that a delivered path sat inside `workspace/`. This package turns each of them into a decision made before the tool dispatches, so an ignored rule becomes a denied call with a reason instead of a corrupted bundle. Design: `ClawsGO-System/09-Target-Architecture/06-delivery-and-workspace.md` (P4) and `08-security-model.md` rows 1, 12, and 13; tests 06-T1, 06-T2, 06-T8, 08-T1.

Every decision runs on one `tools/pre-execute` listener. The `fs/write-intent` and `fs/edit-intent` slots are deliberately left to `@deepseek-ai/dsh-fs-observation-policy`, whose read-before-edit guard is the other half of co-editing safety; deciding at the tool boundary also lets one listener cover the shell, which the `fs` seam never sees.

This is the outer of two layers. The inner one is the sandbox image, where `papers/<slug>/` and `sciplots/<slug>/` belong to the render user and the agent's own uid cannot unlink them. The shell pre-screen is static token matching and is bypassable by construction; the sandbox is what makes bypassing it useless.

## The path table

`classifyPath(path, config)` assigns one of thirteen classes and `decideFsOp(op, cls)` reads the row. Deletion has no column: the `ctx.fs` seam has no unlink, so removal reaches the sandbox only through a shell command.

| Class | Example | read | write | edit |
|---|---|---|---|---|
| `workspace` | `projects/*/workspace/**` | ✓ | ✓ | ✓ |
| `tmp` | `projects/*/tmp/**` | ✓ | ✓ | ✓ |
| `paper-src` | `projects/*/papers/*/src/**` | ✓ | ✓ | ✓ |
| `paper-manifest` | `projects/*/papers/*/*.paper` | ✓ | ✓ + manifest gate | ✓ + manifest gate |
| `paper-versions` | `projects/*/papers/*/versions/**` | ✓ | create-only | ✗ `versions-append-only` |
| `sciplot-code` | `projects/*/sciplots/*/code/**` | ✓ | ✓ | ✓ |
| `sciplot-manifest` | `projects/*/sciplots/*/*.sciplot` | ✓ | ✓ + manifest gate | ✓ + manifest gate |
| `sciplot-versions` | `projects/*/sciplots/*/versions/**` | ✓ | ✗ `render-owned-versions` | ✗ |
| `references` | a `.pdf` in `papers/*/` outside `src/` and `versions/` | ✓ | ✗ `references-outside-papers` | ✗ |
| `skills` | `skills/**` | ✓ | ✗ `skills-read-only` | ✗ |
| `spool-pending` | `.sci/spool/pending/**` | ✓ | create-only | ✗ `spool-create-only` |
| `private` | the rest of `.sci/**` | ✓ | ✗ `sci-private` | ✗ |
| `other` | everything else, including `memory/` | ✓ | ✓ | ✓ |

Reads are allowed everywhere for the top-level session: the contract restricts what the agent may change, not what it may look at. The one refusal a read can earn depends on its bytes, not its location.

A **delegated** session (header `delegationDepth` ≥ 1) is bounded by location before the table is consulted: any path inside the sandbox home but outside the session's own project — a sibling project, the project root, a dot-directory such as `.claude/` — is refused for read, write, and edit under `delegation-scope`, and every path-looking operand of a shell command (`../p2/x`, `~/.claude/...`, `cd ..`) meets the same rule. The skill tree, the delivery spool, and the rest of `.sci/` stay reachable, and paths outside the sandbox home (`/usr`, `/tmp`) are left to the sandbox's own permissions. The studied platform bounded subagents by prose alone, and one still cited four sibling projects as evidence (`clawsgo-analysis/CLAWSGO-SCHEDULING.md` §2.2).

A create-only write whose target already exists is refused under its class's own rule, so a refusal reads the same whether the write was never allowed or only arrived second.

## The three content rules

**Binary reads.** Before a read dispatches, the gate stats the target and, for a regular file between eight bytes and `binaryProbeMaxBytes`, reads it back and matches `%PDF`, PNG, JPEG, `PK`, and ELF magic. A match is refused with the tool that can open it named: the `pdf` skill (`pdftotext -layout`) for a PDF, `sci-read-image` for an image. Anything the probe cannot size or fetch passes; the read tool reports that condition in its own words.

**Manifest ownership.** For a write or edit whose path ends in `.paper`, `.sciplot`, or `.canvas`, the gate reconstructs the resulting file — the content argument for a whole-file write, the literal replacement applied to the current content for an edit — and runs `diffOwnedFields` from `@deepseek-ai/dsh-sci-manifest`. A non-empty result is refused with the field names in the reason. A call carrying neither a whole-content argument nor a replacement pair (an `insert`, for instance) is refused as unverifiable rather than guessed at. A manifest that does not exist yet has no co-editing side, so only validity applies to it.

**Manifest validity.** A write additionally runs the kind's validator, because a write replaces the whole document and an invalid result is that call's doing. An edit is not validated: it is a repair of a document the workbench owns, and refusing it for pre-existing defects would trap the agent in a file it cannot fix. Ownership is checked either way, which is what stops an edit from smuggling a whole rewrite past the validator.

**Recursive deletes.** For a shell-class tool, `screenShellCommand` splits the command line on `;`, `&`, `|`, parentheses, and newlines, honours quoting and escapes, and looks for `rm` with a recursive option, `git clean`, or `find … -delete`. Each operand is resolved against the session's working directory and refused when it lands at or below a project's `papers/` or `sciplots/` directory. The screen over-approximates: an option that takes a separate value contributes it as an operand, because a wrongly raised refusal costs one rephrased command while a miss costs an unrecoverable bundle.

## The sandbox home skeleton

`projectRoot` and the regions under it have to exist before this table decides anything, and the sandbox image cannot bake them: the sandbox daemon mounts `/home/user` as a persistent volume, and the mount masks whatever the image left under that path. The image keeps its skeleton copy outside the home and ships an idempotent `sci-init` on PATH instead, and this package is what runs it — once per mount, so a fresh sandbox holds `projects/`, `memory/`, `references/`, `skills/`, and `.sci/spool/{pending,done,failed}` before the first tool call or workspace RPC reaches them.

The run goes through `ctx.subprocess`, read with `ctx.inject` rather than declared in this plugin's own `inject`, because the path table is complete without a subprocess seam: a Host-only composition keeps the gate and skips the bootstrap. The command runs in `/`, since the tree it creates cannot be its own working directory, and nothing awaits it — a slow or unreachable sandbox must not hold up the load. Exit zero logs the command's own last line at info; a non-zero exit, a signal, a spawn that throws, and a passed `bootstrapTimeoutMs` each log one warning with the stderr tail and leave the gate mounted. The skeleton's absence then stays visible where it costs something, as the `not found` that a workspace or directory call reports.

## Configuration

`projectRoot` is required and must be absolute — the home layout differs per sandbox image, and a wrong guess would classify every science region as unmanaged and silently disable the gate. A relative value fails the load. The sandbox home is its parent, which is where `skillsDir`, `privateDir`, and `spoolPendingDir` are resolved.

`bootstrapCommand` is the skeleton command, split on whitespace into argv with no shell interpretation, and `bootstrapTimeoutMs` is its deadline. A blank command disables the bootstrap, which is what a deployment whose home is provisioned elsewhere sets.

`fsTools` lists the mounted tools of each class together with the argument names the gate reads from each, because a deployment chooses its filesystem tool set. The defaults describe the tools this repository ships: `read` (`file_path`), `write` (`file_path`, `content`), `edit` (`file_path`, `old_string`, `new_string`, `replace_all`), `str_replace_editor` (`path`, `file_text`, `old_str`, `new_str`), and the shell tools `bash` (`command`) and `terminal_send` (`text`). A binding may map each sub-command of a multi-command tool onto the operation it performs, which is how `str_replace_editor view` is judged as a read rather than an edit; an unmapped sub-command stays on the tool's declared class, which is the stricter reading. A tool name listed in two classes fails the load.

## Events

`sci/fs-denied{ op, path, rule, reason }` records every refusal, appended with the envelope's `ignorable` marker: the model already learned of the refusal from the tool result, and the event exists so an audit projection can count refusals per session. `FS_DENIAL_RULES` is the rule vocabulary, and the `./invariant` companion rejects an appended refusal naming anything outside it.

## Model Experience

### Refused filesystem and shell tool calls

#### What the model sees

No prompt section and no tool schema: an allowed call is delegated through `next()` and its result is untouched. A refused call comes back as an error result whose text is the reason, and every reason names one way forward, because a refusal the model cannot act on turns into a retry loop. A version-store write reads `papers/<slug>/versions/ is append-only and belongs to the LaTeX workbench: edit the sources under src/ and compile a new version instead of changing an archived one.`; a PDF read names the `pdf` skill and `pdftotext -layout`; a manifest refusal quotes the offending field names, as in `it changes versions — the LaTeX workbench appends them`; a bundle delete quotes the resolved path it refused.

#### Token effect

Zero on allowed calls. A refusal replaces the tool's own result with one sentence, which is smaller than the successful payload it stands in for, and it does not retry on its own.

#### KV Cache effect

Append-only: the denial occupies the position the tool result would have, so the reusable request prefix is unchanged and no existing KV-cache entry is invalidated.

## Known Limitations and Deferred Work

- **The shell screen is not a shell parser** — command substitution, variables, and an earlier `cd` in the same command line are not interpreted, so a determined command reaches the filesystem and only the sandbox's directory ownership stops it.
- **The binary probe reads the whole file** — the `ctx.fs` seam has no partial read (`readBytes` caps the complete content and fails past the cap), so identifying the first eight bytes costs one full read, and files above `binaryProbeMaxBytes` are not probed at all.
- **Canvas manifests are not validated here** — `validateCanvas` needs to know whether each node's asset exists, which a pre-dispatch gate cannot answer without statting every node; a canvas passes the ownership check here and is validated in full by `deliver_files`.
- **Ownership cannot be checked without the current revision** — a call whose target is unreadable is treated as a create, so a manifest the gate cannot read is protected by the sandbox's permissions rather than by the ownership diff.
- **Classification is textual** — a symlink or bind mount that points out of a region classifies by its resolved path text, so region isolation ultimately rests on the sandbox rather than on this table.
- **A failed skeleton bootstrap reaches nobody but the log** — it runs at load, before any session exists, so the model learns of it only later, as the `not found` from whichever call needed the directory.
