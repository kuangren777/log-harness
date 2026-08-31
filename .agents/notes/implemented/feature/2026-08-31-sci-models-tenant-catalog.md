# Agent Note: `dsh-sci-models` makes the institution's model selection reach the request

Status: implemented

English | [中文](2026-08-31-sci-models-tenant-catalog.zh.md)

## Problem

The `sci` deployment sells more than the three DeepSeek models the harness registers for itself, and an institution buying seats wants to say which of them its members may spend on. The gate now owns that decision — a platform model pool with official prices and a per-institution subset — and nothing in the harness read it. A VM served exactly the models its own composition happened to register, at whatever endpoint that plugin was keyed to, and an institution that closed a model in its console changed nothing about what its members could call.

Filtering the model selector would not have closed it. `ctx.llm`'s catalog is advisory: it populates a selector and does not gate a request, so a client naming a model directly reaches the provider whatever the selector shows. Whatever read the catalog had to also sit on the call.

## Decision

`@deepseek-ai/dsh-sci-models` owns three contributions on one mounted context.

It reads `GET /gate/api/credit/models` with the VM bearer token at boot and every `refreshMs` (default 5 min). Each row carries `model`, `displayName`, `providerLabel`, and `route`, where `route` is `deepseek-official` or `camel-api` — the same strings `ctx.llm` uses for its provider routes, so the gate's routing decision and the harness's adapter selection are one vocabulary rather than two kept in step by hand. A failed read keeps the previous catalog, because emptying it would revoke every model the institution opened while the gate blinked; until the first read succeeds the catalog is `undefined`, which is a different answer from an empty one.

Rows on the `camel-api` route are served by `CamelApiAdapter`, which is `DeepSeekAdapter` with one override. CaMeL Hub speaks the same OpenAI-compatible chat-completions protocol, down to the SSE framing and the usage fields `dsh-sci-credit` prices, and the endpoint, the credential, the catalog, and the request bounds are all already per-operation inputs of that adapter, resolved through the `options()` thunk this package supplies. Only `providerInfo` had to change: the base class states the vendor it was written for, and a selector showing "DeepSeek" for a route the institution knows as CaMeL Hub would misattribute every model on it. The endpoint and the key come from the environment names in `apiBaseEnv` and `apiKeyEnv`; the key resolves per request through `ctx.credentials` with the launch environment as the fallback, and the endpoint and the gate token are read at load and fail it when absent. The route is registered exactly while the catalog lists a model on it and dropped when it stops, so no selector entry can be opened to find nothing in it; because the adapter re-reads the catalog per operation, adding or removing a model on a live route needs no re-registration.

Enforcement is one `llm/stream` waterfall listener. A `(provider, model)` the catalog does not open is refused before `next()` is called at all, with a bilingual `MODEL_NOT_ALLOWED` error finish naming the model, so the refusal costs no provider tokens. The route is part of the comparison, not just the id: a model opened on `camel-api` does not admit the same id on `deepseek-official`, because those are different endpoints at different prices. The built-in DeepSeek models are subject to the same rule — an institution that unchecked one decided its members may not spend on it, and a route the harness registers itself does not change that. A call made before any catalog has been read is admitted under the default `failMode: 'open'` and refused with its own `MODEL_CATALOG_UNAVAILABLE` code under `closed`.

Prices ride along in the same gate answer and are deliberately ignored here. `dsh-sci-credit` reads its own rate card from `GET /gate/api/credit/pricing` and the browser's price hint reads the catalog endpoint directly: one authority for what a model costs, one for whether the tenant may call it.

## Alternatives considered

**Write a minimal OpenAI-compatible adapter inside this package.** Rejected once `DeepSeekAdapter`'s construction was read: it takes its connection facts from an injected `options()` thunk called per operation, its key from an injected resolver, and its catalog from those same facts, so nothing about it is bound to DeepSeek except the vendor name in `providerInfo`, which a subclass overrides in three lines. A second adapter would have re-implemented SSE parsing, the usage mapping `dsh-sci-credit` prices against, request-image offloading, and the retry policy — and would have drifted from all four.

**Enforce by filtering the model catalog `ctx.llm` serves.** Rejected because that catalog does not gate anything. It is read by selectors, and a request that names a model reaches the adapter without consulting it, so filtering would have produced a UI that hides a model an API caller can still spend on.

**Fold the whitelist into `dsh-sci-credit`'s existing `llm/stream` listener.** Rejected: that listener decides whether the tenant can pay, this one decides whether the tenant is allowed at all, and the two answers come from different gate endpoints on different refresh schedules. One deployment may want metering without a catalog (no institution console) and another a catalog without metering (flat-rate seats); merging them would make each impossible without the other.

**Register the `camel-api` route once and leave it holding no models when the catalog lists none.** Rejected: `registerAdapter` accepts an empty route set, but a registered route with no models is a selector entry a user can open and find empty. Dropping the registration removes the entry, and the round trip costs one registry section on a change that happens at human pace.

**Take the gate token as a literal config value, as `sci-credit` does.** Rejected for this package: the value identifies whose catalog is served and belongs in the container's Env beside the CaMeL Hub key, which is a secret and could never be a config literal. Naming both as environment variables keeps one rule for the row. The asymmetry with `sci-credit`'s `vmToken` is known and left for a later pass over that package.

## Consequences

An institution's model selection now reaches the request: a model it closed is refused at the model boundary with a sentence naming the model and the two actions that clear it, and a model it opened on CaMeL Hub becomes a selector entry backed by a working route within one refresh interval. A deployment that mounts this package must supply `CAMEL_API_BASE_URL` and `CAMEL_API_KEY` in the VM's environment or the plugin fails its load; that is deliberate, since a catalog it cannot call is worse than a container that refuses to start.

Unchecking a built-in DeepSeek model hides nothing. `dsh-llm-deepseek` registers its own three models and this package does not edit another plugin's registration, so a closed built-in model still appears in the selector and fails when chosen. The README records that gap and the other three bounds: a catalog edit reaches a running VM within `refreshMs` rather than immediately, one bearer token means every VM of a tenant sees one catalog, and nothing here notices a gate that serves a catalog but no rate card.

## Testing

Package tests pin the catalog read over an injected transport — the URL and bearer header, a tolerated trailing slash, the two labels a row may omit, each malformed row that is skipped rather than failing the answer, an empty selection as distinct from an unreadable one, and every unreadable answer including a non-2xx status and an unreachable gate — and the refreshing copy through a fake scheduler: no catalog before the first success, the previous one kept when a later read fails, and a re-arm after every attempt so one outage does not stop the refresh. The route is pinned for register-on-first-model, drop-on-last-model, and disposal; the credential resolution for store-over-environment, environment fallback, and `MISSING_CREDENTIAL`. The whitelist runs through the real `llm/stream` waterfall behind `ctx.llm.stream()` with a mock adapter, asserting that a refused call never reaches it, and that a built-in DeepSeek model is refused exactly like a hub one. A Loader-composition suite boots a `cordis.yml` against a real loopback gate and a real OpenAI-compatible endpoint (`@deepseek-ai/dsh-llm-mock-server`) with no injected transport or scheduler: it asserts the bearer the gate saw, the `CaMeL Hub` provider the composition published, a served model call arriving at the endpoint with the environment's key and the catalogued model, and a refusal that never reaches it. Per-file coverage is 100%.
