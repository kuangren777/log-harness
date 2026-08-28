# Agent Note: `privilegedTrustedHosts` opens the configuration plane to declared authorities

Status: implemented

English | [中文](2026-08-27-privileged-trusted-hosts.zh.md)

## Problem

The `/api` browser-trust fence accepts loopback plus the deployment's declared `trustedHosts`, but the privileged method set — `settings.*`, `credentials.*`, `agentPreset.read`/`copy`/`remove`/`openDocument`, `host.pickDirectory`/`openPath`, `llm.discoverModels` — passes that same fence with an empty trust list, which pins it to loopback. `authority: 'loopback'` RPC channels do the same. The browser mirrors the pin from the page authority alone: `connection.isLoopback` selected `'host'` or `'memory'` persistence for the settings mirror and every bound scope.

That is correct while `trustedHosts` is only DNS-rebinding defense. It is wrong for a deployment that already has authentication: `dsh --profile sci --trusted-host sci.example --trusted-host sci2.example` behind an authenticating gateway serves a signed-in operator, yet the models settings page reports that settings are unavailable in this browser and the agent-preset picker stays disabled, because the page reads its own hostname and gives up. The pin removed features from a deployment that had the missing layer.

## Decision

`privilegedTrustedHosts` (boolean, default false) is the deployment's explicit statement that an authenticating reverse proxy fronts this process and forwards the public `Host`. When true, the privileged method set and every `authority: 'loopback'` RPC channel — the dedicated-channel route and the shared `/api` interceptor — fence with the same `trustedHosts` list as ordinary methods. It never grants anything to a host outside that list, and it is a no-op while the list is empty, because the opt-in's list is then the empty one the pin already uses.

The Node half publishes the resolved value to the page as a `global` index-injection row, `__DSH_CONNECTION__ = { privilegedTrustedHosts }`. `src/boot-global.ts` is the one home of the property name and the value's fields; both halves import it.

`ConnectionHandle` gains `configurationPlane: 'host' | 'memory'`, which is `'host'` when the page is loopback or the Host published the opt-in. `isLoopback` is unchanged and keeps its own consumers: host-desktop actions (open path, pick directory, the General-settings document action) are about the machine the process runs on, not about who may configure it. ui-settings reads `configurationPlane` for the describe mirror and every bound scope, so the settings pages and the preset picker heal on an opted-in deployment without any change of their own.

`dsh web --privileged-trusted-hosts` is the invocation flag. It is a usage error without at least one `--trusted-host`, and it rides the existing `webRuntime` snapshot — the same value the fence authorities travel on — into the connection row's config.

## Alternatives considered

**Rewrite `Host` to `127.0.0.1` at the gateway.** Rejected because it hides the real origin from the process that must decide trust, and it does not fix the page: the browser reads `location.hostname`, so the client half would still choose memory persistence and the settings pages would stay broken.

**Unpin only agent-preset selection.** Rejected because it addresses the smaller half of the complaint. The settings page's own failure is the settings and credential methods, so the deployment would still show an unavailable models page.

**Make the widening implicit whenever `trustedHosts` is non-empty.** Rejected because `--trusted-host` is how an ordinary LAN deployment declares the names it is reached by, with no authentication anywhere. Implicit widening would hand every anonymous LAN caller the credential store and the preset roster on an invocation whose author asked for reachability only.

## Consequences

A deployment that passes `--privileged-trusted-hosts` alongside its authorities gets working settings, credential, and preset-authoring surfaces in a remote browser, with durable persistence rather than a memory mirror. Every other deployment is unchanged: the flag is off by default, an untrusted `Host` is still refused, and a `trustedHosts`-less invocation cannot widen anything. The opt-in is exactly as strong as the proxy in front of it — without one, it publishes the configuration plane to everyone who can reach a declared authority.

Host-desktop actions stay loopback-only through `isLoopback`: an opted-in remote browser configures the deployment but does not open native dialogs or paths on the host machine.

## Testing

Package tests cover both fence sites over hand-built requests and over a real HTTP server (the Host header a proxied browser sends, parsed by Node), the empty-`trustedHosts` no-op, the loopback-authority dedicated channel and shared-`/api` interceptor under the opt-in, and the index-injection row for both resolved values including its removal with the fiber. The client half is pinned for the global present, absent, and published-false, on loopback and on a public authority. ui-settings' plugin suite asserts persistence follows `configurationPlane` in both directions, and the web-app suites cover flag parsing, the usage error, and the `webRuntime` snapshot the connection row reads. `packages/bundle/web-app/tests/profile-flag-binding.spec.ts` boots the three hops a `--profile` invocation actually performs over a real Loader tree — the real `web-startup` and `web-app` bodies, the bundle patch's own `inject` lists and config expressions — and asserts the value reaches the `connection` row's resolved config, because a bundle-patch expression is resolved by the Loader and a hand-built `ctx.plugin` call would prove nothing about it.
