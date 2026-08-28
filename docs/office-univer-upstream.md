# Vendored upstream: dsh-univer-office

English | [中文](office-univer-upstream.zh.md)

[`@deepseek-ai/dsh-office-univer`](../packages/office/univer/README.md) is a pinned source copy of [dream-num/dsh-univer-office](https://github.com/dream-num/dsh-univer-office) compiled against this tree, plus a prebuilt Univer runtime taken from that project's npm release. This page records what was copied, what was changed, and how to move to a newer upstream.

## Pins

| What | Value |
|---|---|
| Fork commit | `97e348cf44b1eb57d5025dbf7155c8148d72683d` |
| Artifact release | `dsh-univer-office@0.2.10` |
| Artifact integrity | `sha512-drpBS6irjbyUq8MKyr/ya/G1pSLVnVTyExtaeJI0yOsP0NVJkubZyPaPxAAFF2k18s41yEIrYjcl4j/PXjDMsg==` |
| Univer packages | `1.0.0-insiders.20260822-0c0c0dd` (`@univerjs-pro/engine-formula-rust-binding`: `1.0.0-insiders.20260819-8209aa8`; `@univerjs-pro/cli-assets` and `@univerjs-pro/exchange-node-binding`: `0.1.0`) |

The release version and its integrity hash are stated once, in `packages/office/univer/scripts/fetch-artifacts.mjs`; the table above mirrors them.

## What is copied and what is not

Copied as source: `src/host/**`, `src/client/**`, `src/shared/**`, `src/workers/unit-content/license.ts`, and `skills/**`, keeping upstream's file layout.

Not copied: `src/viewer-app`, `src/viewer-support`, `src/gateway-app`, `src/render-machine`, and the rest of `src/workers`. Those are the Univer application code, and building them needs Univer's insider toolchain plus a browser. Their compiled output is taken instead, as `artifacts/gateway.cjs`, `artifacts/unit-content-worker.mjs`, `artifacts/render-machine/`, and `artifacts/viewer/` — about 143 MB, fetched by `pnpm run fetch-artifacts` and git-ignored.

`src/host` is not Univer-free, contrary to what a first reading suggests: `provider/render-operations.ts`, `provider/render-source-operations.ts`, `provider/resource-operations.ts`, and `provider/gateway-univer-service.ts` import `@univer-cli/*` as runtime values, and `artifacts/paths.ts` resolves `@univerjs-pro/engine-formula-rust-binding`. Those packages come from `https://insider-npm-registry.univer.work/` and are declared as ordinary dependencies of the package; the workspace root needs the three scoped-registry lines in its `.npmrc` for an install to resolve them.

## Local modifications

Everything below is a deliberate divergence from the fork commit. Re-apply or retire each one when moving to a newer upstream.

### Serve the Viewer from the harness origin

Upstream runs in a deployment where the browser can reach the Gateway's loopback origin directly. This tree serves the browser from the harness web server, so the Gateway had to move behind a same-origin reverse proxy.

- **`src/host/webServer/gateway-proxy.ts` (new).** Forwards `/univer-gw` (prefix stripped) and `/uf` (verbatim) to the Gateway, bridges the `/uf` WebSocket socket-to-socket, rewrites absolute `/assets/` references in HTML and CSS bodies to `/univer-gw/assets/`, and answers `503 {"error":"gateway-unavailable"}` when no Gateway is reachable and `autoStartGateway` is off.
- **`src/host/webServer/viewer-assets.ts` (new).** Registers one exact `/assets/<name>` route per file in `artifacts/viewer/assets/` (streamed bytes, content type by extension, `cache-control: public, max-age=31536000, immutable`, behind the same browser-trust fence), because the Viewer's Vite preload helper requests its lazy chunks as absolute `/assets/<hash>.js`, which the HTML/CSS rewrite cannot reach. Exact routes win over the web app's `/assets` prefix; content-hashed names cannot collide with it.
- **`src/host/webServer/plugin.ts`.** Takes `ResolvedConfig` and registers the three proxy routes beside the existing `/univer-api` route.
- **`src/host/provider/gateway-univer-service.ts`.** `viewerUrl` and each worktree's `openUrl` / `worktreeUrl` / `mergeUrl` are built from `GATEWAY_PROXY_PREFIX` instead of the Gateway origin, so every target the browser receives is a same-origin path. Query strings are unchanged.
- **`src/client/viewer-url.ts` (new)** and its callers in `src/client/viewer-locale.ts` and `src/client/components/review-panel.tsx`. Upstream edited Viewer targets with `new URL(url)`, which rejects a path with no origin. The three call sites now share one helper that parses against a placeholder base and returns a relative result for a relative input.
- **`packages/host/webserver`** gained `kind: 'exact' | 'prefix'` on `registerUpgrade`, defaulting to `exact`, because the Viewer chooses the WebSocket sub-path at runtime. Upgrade dispatch now shares the request dispatcher's longest-prefix-wins resolution.

### Resolve artifacts from the package root

**`src/host/artifacts/paths.ts`.** Upstream resolves `../artifacts/…` relative to `import.meta.url`, which is correct only for its single-file `lib/index.js` bundle and wrong when the same module is reached from `src`. The paths now hang off the nearest ancestor directory holding a `package.json`, so tests running against sources and a deployment running against `lib` reach one physical `artifacts/`.

### Withhold tools a host cannot run

- **`src/host/tools/names.ts` (new).** `UNIVER_TOOL_NAMES`, the thirteen registrable tool names, exported so a composition and its tests can name them.
- **`src/host/config.ts`.** Adds `disabledTools`, validated against `UNIVER_TOOL_NAMES` at load; an unknown name throws.
- **`src/host/tools/plugin.ts`.** Registration goes through one `register` helper that skips withheld names, so the decision is enforced in the operation that makes it.

### Repository conventions

- **`src/index.ts`, `src/types.ts`, `src/invariant.ts` (new).** The package entry, the types-only face, and the invariant companion every package in this repository owns.
- **`src/client/index.tsx` renamed to `src/client/index.ts`.** `packages/client/tsdown.client.ts` hardcodes `src/client/index.ts` as the client entry; the file contains no JSX.
- **`src/workers/unit-content/license.ts`** is the one file copied out of an otherwise-excluded directory, because `provider/render-operations.ts` imports the license constant from it.
- **Package name and plugin name** are `@deepseek-ai/dsh-office-univer` and `dsh-office-univer`.
- **Peer and dev dependencies on `@deepseek-ai/*`** use `workspace:^` instead of upstream's `0.1.0-rc.8` pins. No API drift was found: both compiler faces typecheck clean against this tree's `0.1.1-rc.2` packages with no source change.
- **`cordis.patch.yml` is not carried over.** Composition is the sci profile's job here, so the package declares no `dsh.bundle.patch`.

## Upgrading

1. Fetch the upstream repository and read its changelog from the fork commit recorded above.
2. Re-copy `src/host`, `src/client`, `src/shared`, `src/workers/unit-content/license.ts`, and `skills`, then re-apply every local modification listed above. The proxy, the artifact paths, and `disabledTools` are the three that will conflict.
3. Bump `VERSION` and `INTEGRITY` in `packages/office/univer/scripts/fetch-artifacts.mjs` to the matching npm release. Read the new integrity from `npm view dsh-univer-office@<version> dist.integrity`.
4. Bump the Univer dependency versions in `packages/office/univer/package.json` to the ones the new upstream pins.
5. Run `pnpm run fetch-artifacts` in the package, then `pnpm tsc -p packages/office/univer/tsconfig.json --noEmit`, the client tsconfig, `pnpm tsx scripts/run-oxlint.ts packages/office/univer`, and `pnpm vitest run packages/office/univer/tests`.
6. Update the pins table and the modification list on this page, and re-record the translation pairing.
