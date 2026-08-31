# sci-skills — bundled skill tree, sandbox sync, and lifecycle curation for the `sci` profile

English | [中文](README.zh.md)

Replaces the skill delivery and listing mechanism of the studied platform (`ClawsGO-System/01-Skills/README.md`, improvements S1–S6 in `ClawsGO-System/09-Target-Architecture/07-skills-plan.md`): a hand-maintained `.clawsgo-rev` string that re-pushed a whole skill directory whenever it moved, a listing that injected all fifteen skills forever with no retirement path, and three skills whose frontmatter description had been silently truncated to a bare name. Here the tree's identity is a Merkle digest so a round writes only the files whose content changed, the listing is filtered by a lifecycle projection folded from the session log, and an empty description fails the plugin load by name.

The fifteen skill bundles ship in `skills/`. They must live inside this package directory: tsdown's workspace glob `packages/*/*` treats a loose directory under `packages/sci/` as a package and fails the whole `typecheck`.

## Surfaces

| Surface | Where | Config |
|---|---|---|
| Skill listing provider | `ctx.skills.registerProvider()`, provider name `sci` | `providerName` (default `sci`) |
| Sandbox copy of the tree | `ctx.fs`, under `sandboxRoot` | `skillRoot`, `sandboxRoot`, `syncOnStart` |
| Digest manifest | `<sandboxRoot>/.sci/skills.json` | — |
| Skill body referenced-text store (`mode: 'live'`) | `ctx.referencedText.registerStore()`, store name `sci` | `providerName` (default `sci`) |
| `sci_skill_usage` projection | `ctx.storageDomain`, domain `sci_skills` | `skillToolName` (default `skill`) |
| `sci_skill_lifecycle` projection | `ctx.storageDomain`, domain `sci_skills` | `staleAfterDays` (default `90`), `pinned` |
| Session event `sci/skills-synced` | appended to every session opened after a sync round | — |

`sandboxRoot` is required and has no default: the home layout differs per sandbox image, and a guessed default would publish skills where the model cannot open them.

## Sync

`computeSkillHash(dir)` folds each file's sha256 in sorted relative-path order into one directory digest; `planSync(local, remote, published)` compares two digest manifests and returns the `<skill>/<relative path>` entries to write and to retract. A round reads `<sandboxRoot>/.sci/skills.json`, writes the changed files through `ctx.fs`, retracts the dropped ones, and writes the manifest back. `$SCI_SKILL_ROOT` in a skill body is expanded to `sandboxRoot` as the file is written, so one SKILL.md is correct both in this repository and in the sandbox.

The manifest is the sandbox's claim about itself, never an observation, so matching digests are not enough to skip a file: `planSync` probes the sandbox for every entry the two manifests agree on and re-publishes the ones that are gone. Deleting a published file from the model's own shell therefore costs one round, not the skill.

That same file is writable by the model, and every key it carries becomes a path this round writes or an argument of the retraction `rm`. `parseManifest` drops any skill or file key that is empty, absolute, drive-qualified, or carries a `..` segment — a skill key may carry no path separator at all — and logs one warning per dropped key; `createSyncFileSystem` then re-checks every resolved retraction target against `sandboxRoot` with `FileSystem.contains` and throws before `rm` exists as a process. The second check is the load-bearing one: no `ctx.fs` policy observes a subprocess.

`ctx.fs` has no unlink verb, so retraction crosses to `ctx.subprocess` through `FileSystem.processPath()` — the documented bridge to another OS capability in the filesystem's own execution world. Without a subprocess provider nothing is retracted; those files keep their manifest entries so the next round with one mounted retries them, and they are absent from the event's `removed` list.

## Curation

Usage is derived from the session log: a `tool/call` event whose `name` matches `skillToolName` has its skill name parsed out of the recorded `arguments` JSON. There is no `skill/invoked` event. `curateLifecycle` then ages the tree with the clock passed in: a skill unused past `staleAfterDays` becomes `stale` and lists by its first sentence only, a skill that left the tree becomes `archived` and is not listed at all, and a `pinned` skill is always `active`. A skill with no recorded use ages from when it first appeared in the tree. `./invariant` asserts the pin exemption over the `domain/changed` stream.

The `sci` presets mount this provider **alone**. Mounting `@deepseek-ai/dsh-skill-filesystem` beside it over the same directories would re-list exactly the skills this package curates away.

## Model Experience

### Skill catalog

#### What the model sees

One catalog entry per listed skill, rendered exactly as any `ctx.skills` provider's entries are. An `active` skill carries its full frontmatter description, a `stale` one shrinks to its first sentence, and an `archived` one is absent from the catalog. The `sci` presets mount this provider alone, so nothing re-lists a skill this one curated away.

#### Token effect

One description per listed skill on every request. Ageing a skill to `stale` replaces that description with a single sentence and archiving drops the entry, so the standing catalog cost falls as the tree ages instead of growing with it.

#### KV Cache effect

A curation state change rewrites the catalog block, so that assembly pays one KV-cache miss on it. `curateLifecycle` moves a skill only on a recorded load or a crossing of `staleAfterDays`, never per turn.

### Skill bodies and resources

#### What the model sees

Loading a skill returns its `<skill_content>` with `$SCI_SKILL_ROOT` already expanded to `sandboxRoot`, and `resourceBase` names the sandbox copy, so every path the model reads out of a body is one it can open. The body rides a `referenced-text` block backed by a live store: every request re-resolves it to the catalog's current body, so updating a skill reaches old sessions instead of stranding them on a digest mismatch, and a skill the catalog no longer lists falls back to the recorded raw body fetched from the source's permanent object store. The `sci/skills-synced` record of a sync round is log-only and never enters model history.

#### Token effect

A body is charged only on the turn the model loads it. A sync round costs nothing whatever it wrote or retracted, and a warning about a rejected manifest key reaches the host log, never the model.

#### KV Cache effect

A loaded body appends to history and disturbs no earlier prefix while its content is stable; publishing a new body re-resolves every request position that carries the reference, one full cache miss per session that loaded it. The sync record carries the envelope's `ignorable: true`, so it stays out of model context entirely and a build without this plugin skips it instead of refusing to reconstruct the log.

## Known Limitations and Deferred Work

- **Binary skill resources are not synced.** `ctx.fs` exposes `writeText` only, so a skill bundle carrying an image or an archive cannot be published. Every shipped bundle is text (Markdown, Python, XSD, XML, HTML, plain text); `__pycache__` and `.git` are excluded from both hashing and publication.
- **The in-house skill bodies still describe the studied platform's mechanisms.** Only the mechanical fixes are applied so far (S3–S5: descriptions, `$SCI_SKILL_ROOT` paths, `deliver_files` and chapter-title citations). The behavioural rewrites 07-skills-plan specifies per skill — `sci-recall` reading the dsh session store instead of Claude Code JSONL, `sci-plot --dry-run`, `sci canvas lint`, `sci paper archive` — are a later stage, as is the sixteenth bundle `sci-references`.
- **A retired skill body that used `$SCI_SKILL_ROOT` is unrecoverable by reference.** The logged `sha256` covers the expanded body while the object store is keyed by the raw body's digest, so the fallback for a skill absent from the catalog only resolves bodies that contained no `$SCI_SKILL_ROOT`; others fail the read with the chained source error.
- **Usage is projected live, not rebuilt.** The listener folds `session/event` as it arrives; rebuilding both tables from a cold log is `sci-audit`'s `rebuild` path (spec P9).
