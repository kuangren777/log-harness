# Agent Note: a profile that declares its preset roots keeps them

Status: implemented

English | [中文](2026-08-27-profile-declared-preset-roots.zh.md)

## Problem

`apps/cli`'s `composeProfile` appended a last-wins overlay for the composed `agent-presets` row that replaced `roots` wholesale with the launcher's own installed preset tree (`apps/cli/config/agent-presets`). The shipped root has to come from the launcher — it sits beside the app's own config, in both the source and built layouts — but replacing rather than merging made the field unwritable by anyone else: a value in a bundle's patch layer was discarded on every boot.

`dsh --profile sci` paid for that twice. Its roster listed the launcher's four general-purpose presets — `code`, `cordis`, `minimal`, `standard` — which compose tools the profile disables and a sandbox it does not run in, and it listed neither of the two presets the bundle ships, so `default: sci-balanced` resolved to nothing. `packages/sci/sci-profile/cordis.patch.yml` recorded the state as the one cross-package change the bundle needed. The only workaround was hand-seeding `$DSH_HOME/.agent-presets/sci-*`, which lands the presets under `user` trust: the picker then labels them as the person's own and offers to delete them.

## Decision

The launcher supplies the shipped root only for a composition that declares none. `resolvePresetRootPatch(row)` (`apps/cli/src/profile-boot.ts`) returns the overlay when the composed roster row carries no `roots` or an empty one, and `undefined` when it declares a non-empty list — the declared value then reaches `dsh-agent-presets` untouched, including an unevaluated `!!js` node, which the launcher must not try to read.

A bundle names its own directory through `dshBundlePath('<package>', ...segments)`, a new resolver in the Loader `!!js` scope beside `dshHomePath`. `bundlePathResolver` (`packages/boot/app-boot/src/profile.ts`) builds it from the loaded profile: a listed bundle answers from the `packageDir` `loadProfile` already resolved, any other package through `resolveBundleDir`'s two anchors. `profile-boot` provides it in `boot()`'s `prepare` hook, before any entry mounts, because the row carrying the expression interpolates it as it mounts. Only a resolver that can find the package knows where its files are, which is why the path cannot be a literal and why the launcher, not the bundle, evaluates it.

`sci-profile`'s patch layer now declares one root — its own `config/agent-presets`, `trust: system` — and leaves `includeUserRoot` at its default, so `$DSH_HOME/.agent-presets` is still scanned and a deployment can still add presets. `system` trust is what removes the "· 用户" suffix from the picker; no client change was needed for that.

`config/**` is now allowlisted in `check-workspace-constraints`' `packageFileExtras` for `@deepseek-ai/dsh-sci-profile`. The manifest already listed the directory in `files` but the gate had no entry, so the gate was failing; the published package must carry the tree the patch layer points at.

## Alternatives considered

**Teach `apps/cli` to resolve `@deepseek-ai/dsh-sci-profile`'s `BUNDLED_PRESET_ROOT`.** Rejected: the launcher would import a profile-specific package to serve one profile, and the next bundle that ships presets would need the same edit. The mechanism belongs at the seam both sides already share — the patch layer and the `!!js` scope.

**Let the roster resolve a root by package specifier (`{ package, path }`).** Rejected: `dsh-agent-presets` would gain a module-resolution concern, with an anchor it does not have. The launcher is the component that resolved the bundle in the first place.

**Prepend the declared roots and keep the shipped root behind them.** Rejected: first-root-wins makes that harmless for ids, but the four `dsh` presets would still be listed and selectable in a profile whose tools they do not compose.

**Set `includeUserRoot: false` in the sci patch.** Rejected: it would make the profile unauthorable — no writable root, so `copy()` fails and a deployment cannot add a preset at all.

## Consequences

`dsh --profile sci`'s picker shows exactly `单体 / Solo` and `蜂群 / Swarm`, both with `system` trust and no "user" suffix, plus anything a deployment authored in `$DSH_HOME/.agent-presets`. Every other profile is unchanged: it declares no roots, so the launcher's overlay still lands.

A deployment that hand-seeded `$DSH_HOME/.agent-presets/sci-balanced` or `sci-cluster` sees no duplicate row — `discoverPresets` is first-root-wins per id and the declared root is scanned before the user root — but the seeded copy is now dead weight: it is shadowed, its edits have no effect, and nothing reports the shadowing. Delete those directories.

A bundle patch that uses `dshBundlePath` fails loud under a launcher that does not provide it: the expression throws `dshBundlePath is not defined` as the row mounts, rather than resolving to a wrong path.

## Testing

`packages/boot/app-boot/tests/profile.spec.ts` covers the resolver's listed-bundle, unlisted-package, no-segment, and unresolvable cases; `app-boot.spec.ts` boots a real Loader tree whose row config is a `dshBundlePath` expression and asserts the interpolated value. `apps/cli/tests/preset-roots.spec.ts` pins `resolvePresetRootPatch` for a declared list, an empty list, a missing `config`, an absent row, and a declared root still carrying its `!!js` node. `packages/sci/sci-profile/tests/composition.spec.ts` asserts the composed row's single `system`-trust root and its expression, and that discovery over `BUNDLED_PRESET_ROOT` yields exactly the two science presets — unbroken, `system`-trusted, named `单体 / Solo` and `蜂群 / Swarm` — and none of the four `dsh` ones. The profile dump snapshot carries the new row.
