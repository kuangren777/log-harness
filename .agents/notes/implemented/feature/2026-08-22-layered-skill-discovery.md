# Agent Note: Layered project skill discovery walks the cwd's ancestors

Status: implemented

English | [中文](2026-08-22-layered-skill-discovery.zh.md)

## Problem

`dsh-skill-filesystem` scanned exactly two project directories, both at the nearest `.git` ancestor. A monorepo package, a nested worktree, or any workspace organized below its repository root could not carry its own skills, and skills a user keeps for the whole home directory were invisible. Users arriving from Claude Code also expect `.claude/skills` to be read at both the project and the user level.

## Decision

Project discovery walks. The lookup cwd and every ancestor up to the walk anchor each contribute the configured `projectSkillDirs` (`.dsh/skills`, `.agents/skills`, `.claude/skills`), with the nearest directory winning a duplicate skill name. The anchor is the operating-system home directory when the cwd is inside it, otherwise the nearest `.git` ancestor, otherwise the cwd alone. `walkAncestors: false` restores the single-directory scan.

Ranks stay inside the existing project band: a root's rank is `100 + depth * projectSkillDirs.length + index`, so precedence is positional rather than per-directory-name. The band's ceiling is the `custom` rank, 300; a walk that would reach it fails that lookup with a `RangeError` naming the walk, which the registry logs as a skipped provider and reports as an incomplete catalog. Compressing ranks was rejected: they are this provider's precedence contract with the registry, and scaling them would silently reorder `custom`, user, and bundled roots.

A walked directory whose skill root is also one of the three user roots is dropped from the project band, so `~/.dsh/skills` keeps rank 400 and its `.system` skip when the home directory is an ancestor. The new `user-claude` root (`<claudeHome>/skills`, `$DSH_CLAUDE_HOME` or `~/.claude`) ranks 550, between `user-agents` and bundled skills. `SkillCandidate` gained `root`, the directory a candidate was discovered in, and `SkillSource` gained `project-claude` and `user-claude`.

Every walked root of one cwd shares the owner key `project:<anchor>` in the watch manager, so `watchMaxProjects` still bounds distinct cwds rather than directories and evicting one releases all of its roots. The cost is `(depth + 1) × projectSkillDirs` watch handles per cwd.

## Test isolation

`~/.claude/skills` is a real directory on many developer machines, so every suite that mounts this provider must pin its user roots. `dsh-acp-snapshot` and `dsh-loader-smoke` now pin `DSH_CLAUDE_HOME` beside `DSH_HOME` and `DSH_AGENTS_HOME`; the ACP harness also pins `HOME`/`USERPROFILE` to the generated cwd, because a scenario placing its workspace under the real home would otherwise walk into that home's skill roots.

## Alternatives considered

**Keep one project root and add `.claude/skills` beside the other two.** Rejected: it reads the new directory without fixing the reason the request arrived — a workspace below its repository root still cannot own skills, which is the layering Claude Code users rely on.

**Rank each directory name globally (`.dsh` always 100, `.agents` always 200).** Rejected: with a walk, a name-keyed rank makes a distant ancestor's `.dsh/skills` outrank the cwd's `.agents/skills`, which inverts the nearest-wins rule the layering exists to provide.

**Scale ranks to fit the band on a deep walk.** Rejected: ranks are compared against `custom`, user, and bundled roots owned elsewhere, so compression would reorder unrelated sources. Failing loud keeps the band's meaning fixed and names the two configuration escapes.

**Give the deduplicated home-level directory its project rank instead of its user rank.** Rejected: `~/.dsh/skills` carries the `.system` skip, and two entries for one directory would either duplicate its skills or make the skip depend on which entry won.

## Consequences

A cwd deep under the home directory now opens up to `(depth + 1) × 3` roots, so discovery does more directory reads and holds more watch handles; `walkAncestors: false` is the documented opt-out. Skills placed in an intermediate directory take effect without a `.git` marker, and a home-level `.claude/skills` reaches every session. The keyless `skill-load` snapshot pins the Claude root in the catalog and a shadowed same-name skill.
