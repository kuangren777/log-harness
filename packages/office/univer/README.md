# @deepseek-ai/dsh-office-univer

English | [中文](README.zh.md)

Univer office documents (`.univer` files: sheets, docs, slides, boards) in the harness. One plugin composing four roles: a **Service Provider** (`ctx.univer`) over an out-of-process Univer Gateway, a **tool Consumer** registering the thirteen `univer_*` tools, a **skill** contribution, and a **Web Consumer** that puts the Gateway's browser Viewer on the harness origin behind a reverse proxy.

Vendored from [`dsh-univer-office`](https://github.com/dream-num/dsh-univer-office). The fork point, the pinned runtime release, and every local modification live in [docs/office-univer-upstream.md](../../../docs/office-univer-upstream.md).

## Architecture

The Gateway is a separate process, not a library: it owns the collaboration store (libsql), the document runtime, and the Viewer assets, and it listens on its own loopback origin (`http://127.0.0.1:<gatewayPort>`, advancing by one while a port is taken). `GatewaySupervisor` starts and reaps it; one-shot content operations run in a `unit-content-worker` subprocess instead.

Both the Gateway executable and the Viewer are **prebuilt bytes**, not compiled from this repository. `pnpm run fetch-artifacts` downloads the pinned `dsh-univer-office` npm release, checks its tarball against a recorded sha512, and extracts `artifacts/{gateway.cjs,unit-content-worker.mjs,render-machine/,viewer/}` (~143 MB). `artifacts/` is git-ignored; `src/host/artifacts/paths.ts` anchors every artifact on the package root so the same constants resolve from `src` under test and from `lib/index.js` in a deployment.

## The reverse proxy

A browser tab served by the harness cannot reach the Gateway's loopback origin, and the prebuilt Viewer addresses its own backend with absolute paths derived from `location.origin`. `src/host/webServer/gateway-proxy.ts` therefore registers two prefix routes and one prefix upgrade route on [`dsh-host-webserver`](../../host/webserver/README.md):

| Route | Prefix stripped | Purpose |
|---|---|---|
| `/univer-gw` | yes | The Viewer document and its chunks. `/univer-gw/?file=KEY` reaches the Gateway as `/?file=KEY`. |
| `/uf` | no | File content the Viewer requests at runtime as `/uf/<fileKey>`; forwarded verbatim. |
| `/uf` (upgrade) | no | The collaboration WebSocket, bridged socket-to-socket. |

HTML and CSS responses have absolute `/assets/` references rewritten to `/univer-gw/assets/` before they reach the browser, because the harness web app already serves `/assets/*` and the two would otherwise collide. Nothing registers at `/assets`. Bodies of other content types stream through untouched.

Every route is fenced. `/univer-api`, `/univer-gw`, and the `/uf` upgrade all run the deployment's browser-trust check — `ctx.connection.isTrustedRequest`, the same decision the RPC channel applies to `/api` — before anything else, and answer 403 when it refuses. That fence is why `connection` is a required injection rather than an optional one: it owns `trustedHosts`, and a second copy of that policy here could disagree with `/api`. The hop to the Gateway starts from a header set this proxy controls: `cookie`, `authorization`, `proxy-authorization`, `forwarded`, and every `x-forwarded-*` are withheld, because the Gateway is an unauthenticated loopback service that would otherwise receive the operator's ambient credentials and a client-chosen client address. Coming back, `set-cookie` is dropped so the Gateway cannot set cookies on the harness origin. Upstream targets are built from the PARSED pathname, never a slice of the raw target, and a request that leaves the prefix under normalization or carries an encoded traversal segment is refused with 400.

Every Viewer target the host emits (`viewerUrl`, and each worktree's `openUrl` / `worktreeUrl` / `mergeUrl`) is a same-origin path rather than the Gateway origin. When no Gateway is running the proxy starts one if `autoStartGateway` is set, and otherwise answers `503 {"error":"gateway-unavailable"}`; a Gateway that dies mid-response resets the connection rather than reporting a truncated body as complete.

## Config

| Key | Default | Meaning |
|---|---|---|
| `gatewayPort` | `9080` | First loopback port tried by the bundled Gateway; occupied ports advance by one. |
| `autoStartGateway` | `true` | Start the Gateway when file state or a proxied request first needs it. |
| `gatewayStartupTimeoutMs` | `10_000` | Time allowed for the Gateway to become healthy. |
| `gatewayRequestTimeoutMs` | `3_000` | HTTP timeout for Gateway state reads. |
| `gatewayMutationTimeoutMs` | `60_000` | HTTP timeout for Gateway mutations. |
| `proxyTimeoutMs` | `30_000` | Idle deadline for one proxied browser request or WebSocket handshake — each byte restarts it, so only a stalled Gateway trips it and answers 504. There is no total cap on one response. |
| `unitContentOperationTimeoutMs` | `120_000` | Maximum lifetime of one content-worker process. |
| `screenshotOperationTimeoutMs` | `120_000` | Maximum lifetime of one browser-backed screenshot. |
| `screenshotMaxPages` | `30` | Maximum pages captured by one screenshot call. |
| `screenshotMaxPixels` | `16_777_216` | Maximum pixel count per rendered image. |
| `resourceCacheRoot` | `$DSH_HOME/cache/dsh-univer-office/resources` | Persistent cache for downloaded resource-library SVGs; must be absolute. |
| `resourceDownloadTimeoutMs` | `15_000` | Timeout for one resource-library download. |
| `resourceOperationTimeoutMs` | `120_000` | Maximum lifetime of one resource-library tool call. |
| `unitContentCommitTimeoutMs` | `5_000` | Wait for a collaboration commit acknowledgement before confirming by pull. |
| `stateCacheTtlMs` | `1_000` | Freshness window for file-state reads. |
| `unitCacheTtlMs` | `5_000` | Freshness window for changed-unit reads. |
| `tools` | `true` | Register the model-facing `univer_*` tools. |
| `skills` | `true` | Register the bundled Univer skills. |
| `disabledTools` | `[]` | Tool names withheld from registration. Every entry must name a real tool; an unknown name throws at load rather than leaving the deployment advertising a tool it meant to remove. |

`disabledTools` exists for hosts that cannot satisfy a tool's requirements — no Chromium rules out `univer_screenshot` and `univer_lint`, no outbound network rules out `univer_resources`. The registrable set is exported as `UNIVER_TOOL_NAMES`.

## Mounting the tools separately

An agent preset composes its own tool surface, so the tool Consumer is also a standalone row: `@deepseek-ai/dsh-office-univer/tools`. Mounting it gives one agent scope the `univer_*` tools over the shared host-plane Provider, without a second Provider or a second Gateway.

```yaml
- id: tool-univer
  name: '@deepseek-ai/dsh-office-univer/tools'
  config:
    disabledTools: [univer_screenshot, univer_lint]
```

`disabledTools` is the only key this row owns. Every timeout, limit, and path comes from `ctx.univer.config`, which the Provider publishes, so a row cannot drift from the Provider it calls. A deployment picks one of the two forms: mounting this row while the package entry still has `tools: true` registers every tool name twice, which the tool registry rejects.

## Model Experience

### Tool schemas

#### What the model sees

The [thirteen generated `univer_*` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-office-univer), each over one workspace-confined `.univer` file. `univer_new` creates an empty container; `univer_status` reports the Gateway and the file's worktrees; `univer_worktree` creates, merges, or discards a worktree; `univer_unit` adds, renames, or removes Units. Content flows through `univer_import`, `univer_inspect`, `univer_execute`, and `univer_export`; `univer_lint` and `univer_compile_svg` check and build layout; `univer_screenshot` captures rendered pages; `univer_api` searches the version-matched Facade reference; `univer_resources` reads the bundled SVG registries. Names withheld by `disabledTools` are absent from the request entirely, and `univer_screenshot` appears only while an attachment store is mounted, because its result must durably reference image bytes.

#### Token effect

Fixed schema cost on every request, proportional to the number of tools this deployment left registered. `univer_api` and `univer_resources` carry the longest descriptions.

#### KV Cache effect

Prefix-stable: the definitions are static per composition, and `disabledTools` changes the prefix once, at load. Mounting or disposing the tool row invalidates reuse from the schema block.

### Tool results and failures

#### What the model sees

Operations return `{ ok: true, operation, file, result }`; reference reads return `{ ok: true, operation: 'api', result }`. A `UniverError` reaches the model as `Error [CODE]: message` — a domain code such as `GATEWAY_UNAVAILABLE`, `WORKTREE_NOT_FOUND`, or `FILE_PERMISSION_DENIED`, never a Gateway URL, port, or subprocess detail. Tool call cards render `generic`.

#### Token effect

Result size follows the document: an inspection of a large Sheet range or a full worktree listing is the dominant cost, while lifecycle operations return a few fields. Screenshot results add image attachments on top of the JSON.

#### KV Cache effect

Append-only; each result follows the reusable request prefix and does not invalidate existing entries.

### Approval prompts

#### What the model sees

`univer_worktree` with `action: merge` or `action: discard` routes through `tools/pre-execute` as an approval `ask`, because both publish or destroy work. The model sees the ordinary allowed or denied outcome; the reason text (`Merging publishes the selected Univer worktree into trunk.`, `Discarding permanently removes the selected Univer worktree changes.`) reaches the person approving, not the request.

#### Token effect

None on the request. A denial arrives as the standard error result.

#### KV Cache effect

None; the gate adds no prompt content.

## Known Limitations and Deferred Work

- **The Univer runtime is prebuilt, not built here.** `artifacts/` comes from a pinned npm release verified by sha512; the Gateway, Viewer, render machine, and content worker are opaque bytes to this repository. Upgrading them means bumping `VERSION` and `INTEGRITY` in `scripts/fetch-artifacts.mjs` together with the vendored sources — nothing in CI rebuilds them, and a checkout without `pnpm run fetch-artifacts` has no Gateway to start.
- **Univer packages resolve from an insider registry outside this project's control.** `@univer-cli/*`, `@univerjs/*`, and `@univerjs-pro/*` are prerelease builds served by `insider-npm-registry.univer.work`; the pinned versions are not on the public npm registry, and the native `@univerjs-pro` bindings are what the Gateway and content worker load at runtime.
- **The bundled development license is bound to `localhost` and expires 2026-11-15.** `src/workers/unit-content/license.ts` carries it verbatim from upstream. After that date the render and content paths stop accepting work, and a deployment reachable under any other host name is outside the license's domain list.
- **Rendering needs a browser the harness does not ship.** `univer_screenshot`, `univer_lint`, and `univer_compile_svg` drive the render machine through `puppeteer-core`, which locates a Chromium the host must already have. Deployments without one should name those tools in `disabledTools` so the model is never offered a tool that cannot run.
- **Most of the vendored sources are exempt from the per-file coverage gate.** The exemption list is in `vitest.config.ts`. Fourteen harness-authored or harness-modified files stay gated at 100%: `src/index.ts`, `src/invariant.ts`, `src/tools.ts`, `src/client/viewer-url.ts`, `src/client/viewer-locale.ts`, `src/host/config.ts`, `src/host/index.ts`, `src/host/artifacts/paths.ts`, `src/host/provider/plugin.ts`, `src/host/service/univer-service.ts`, `src/host/tools/names.ts`, `src/host/tools/plugin.ts`, `src/host/webServer/gateway-proxy.ts`, and `src/host/webServer/plugin.ts`. Everything else — the Gateway HTTP and worker adapters, process supervision, the document operations, the tool definitions, and the browser components — is a pinned upstream copy covered by upstream's own smoke suite. Two of the exempt files carry local edits that are covered indirectly: `src/client/components/review-panel.tsx` calls the gated `editViewerUrl`, and `src/host/provider/gateway-univer-service.ts` emits the gated `GATEWAY_PROXY_PREFIX`.
- **The Gateway itself is unauthenticated and this proxy is its only fence.** Anything already inside the host process can reach `http://127.0.0.1:<gatewayPort>` directly, with no browser-trust check, no header stripping, and no path validation — the defenses documented above live in the routes, not in the Gateway. Binding policy is the webserver's (`host`), and the fence is not an authentication layer: it closes the DNS-rebinding and cross-site paths a browser opens, nothing more.
- **A body over `content-encoding` is never rewritten.** `/assets/` re-rooting needs the text, and rewriting compressed bytes would produce a body the browser cannot decode while the encoding header still claimed it could. A Gateway that begins compressing the Viewer document would therefore serve `/assets/*` references the harness web app answers instead; nothing detects that automatically.
- **The pinned Univer packages declare no license, so `gen-third-party-notices` refuses to run.** Neither the `@univer-cli/*` insider builds nor the `@univerjs-pro/*` native bindings publish a `license` field or a LICENSE file. `scripts/gen-third-party-notices.ts` records them as `All rights reserved (no license declared)`, which its own runtime-license check then rejects — deliberately, because distributing them is a decision this repository cannot infer. Confirm the terms with Univer and record that decision before any release that redistributes `artifacts/` or these packages.
