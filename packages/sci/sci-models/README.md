# dsh-sci-models

English | [中文](README.zh.md)

**The institution decides which models its members may call; this plugin makes that decision reach the request.** The gate owns the catalog — a platform-wide model pool, a per-institution subset, and the official price of each row (`12-Multi-Tenant/artifacts/sci-gate/`, outside this repository). This package reads the tenant's slice of it, registers the CaMeL Hub provider route it names, and refuses every model call the catalog does not open.

## The catalog

`GET /gate/api/credit/models` with the VM bearer token, at boot and every `refreshMs` (default 5 min). Each row carries `model`, `displayName`, `providerLabel`, and `route` — `deepseek-official` or `camel-api`, which are also the `ctx.llm` provider route names, so the gate's routing decision and the harness's adapter selection are one string rather than two vocabularies kept in step by hand. A row missing an id or naming an unroutable route is skipped; one malformed row does not revoke the rest.

A failed read **keeps the previous catalog**, because emptying it would revoke every model the institution opened while the gate blinked. Until the first read succeeds the catalog is `undefined`, which is a different answer from an empty one: the tenant's selection is unknown rather than empty, and `failMode` decides what happens to a call made in that window (default `open`, since the gate already refuses a call the tenant cannot pay for).

Prices travel in the same answer and are deliberately ignored here. The browser's price hint reads them from the gate directly, and `@deepseek-ai/dsh-sci-credit` reads its own rate card from `GET /gate/api/credit/pricing`: one authority for what a model costs, one for whether the tenant may call it.

## The `camel-api` route

Rows on the `camel-api` route are served by a `CamelApiAdapter` — `DeepSeekAdapter` with the selector name `CaMeL Hub`. The adapter is reused rather than reimplemented because CaMeL Hub speaks the same OpenAI-compatible chat-completions protocol, down to the SSE framing and the usage fields the metering prices; only the endpoint, the credential, the catalog, and the display name differ, and all four are already per-operation inputs of that adapter. `providerInfo` is the one override: the base class states the vendor it was written for, and a selector showing "DeepSeek" for a route the institution knows as CaMeL Hub would misattribute every model on it.

The endpoint comes from the environment name in `apiBaseEnv` (default `CAMEL_API_BASE_URL`) and the key from `apiKeyEnv` (default `CAMEL_API_KEY`), resolved per request through `ctx.credentials` and falling back to the launch environment. Only the gate token **fails the load when absent**: it names whose catalog is served, so without it this plugin has nothing to read and nothing to enforce. An absent endpoint is reported once at load and registers no route, which leaves the whitelist working over the models the tenant does have — a deployment whose institutions buy only the built-in DeepSeek models never sets it.

The route is registered exactly while the catalog lists a model on it and dropped when it stops, so a selector never offers an entry with nothing in it. The adapter re-reads the catalog per operation, so adding or removing a model on an already-registered route needs no re-registration.

## The whitelist

One `llm/stream` waterfall listener refuses any `(provider, model)` the catalog does not open, before `next()` is called at all, with a bilingual `MODEL_NOT_ALLOWED` error finish naming the model. `ctx.llm`'s own model catalog is advisory — it populates a selector and does not gate a request — so a client that names a model directly would otherwise reach the provider whatever the selector showed.

The built-in DeepSeek models are subject to it exactly as the CaMeL Hub ones are: an institution that unchecked one has decided its members may not spend on it, and a route the harness registers itself does not change that decision. The route is compared too, not just the id: a model opened on `camel-api` does not admit the same id on `deepseek-official`, because those are different endpoints at different prices.

A call made before any catalog has been read is admitted under the default `failMode: 'open'` and refused with `MODEL_CATALOG_UNAVAILABLE` under `closed`. That second code is deliberately not `MODEL_NOT_ALLOWED`: the model may well be open, and telling the user to ask an administrator for it would send them to someone who already granted it.

## Configuration

`gateUrl` (default `http://127.0.0.1:3079`) is the gate that publishes the catalog. `vmTokenEnv`, `apiBaseEnv`, and `apiKeyEnv` name environment variables rather than carrying values: the token identifies whose catalog is served and the key is a secret, and both belong in the container's Env beside the other credentials. `refreshMs` (minimum 1 s) trades how long a revoked model stays callable against one request per VM per interval; `requestTimeoutMs` bounds one catalog read. Full field list: [config catalog](../../../docs/config-catalog.md#deepseek-aidsh-sci-models).

## Model Experience

None, as the plugin registers no prompt, tool, or context of its own: the catalog reaches the user's model selector, and its refusal is an error finish raised out of the agent loop as an `LlmError` (`packages/core/agent-loop/src/agent.ts`) rather than a model-visible input.

#### KV Cache effect

None on an admitted call: no request field is read or rewritten, so the provider prefix the next turn reuses is byte-identical to the one the loop assembled. A refused call is not sent at all, so it materializes no prefix and invalidates none.

## Known Limitations and Deferred Work

- **Unchecking a built-in DeepSeek model hides nothing; it only refuses the call.** `@deepseek-ai/dsh-llm-deepseek` registers its own three models and this package does not edit another plugin's registration, so a model an institution has closed still appears in the selector and fails when chosen. Removing it would need a filtering seam on the provider catalog that `ctx.llm` does not have.
- **A catalog edit reaches a running VM within `refreshMs`, not immediately.** A model added or revoked in the institution console is callable or refused up to one refresh interval later; the gate publishes no change notification, so shortening the window costs one request per VM per interval.
- **A catalogued `camel-api` model fails at dispatch when the endpoint is unset.** Without `CAMEL_API_BASE_URL` the route is never registered, so such a model stays selectable and in the whitelist and its call ends with `NO_ADAPTER` rather than a sentence naming the missing configuration. Reporting it at load is the signal; making the refusal name the cause would need this package to own a route it deliberately does not register.
- **Every VM of a tenant sees one catalog.** The bearer token identifies the tenant, not the member, so a per-user model allowance would need a different credential on the read.
- **Prices are read by other consumers, not here.** A gate that serves this catalog but no matching rate card still enforces correctly, and `dsh-sci-credit` then prices a catalogued model it cannot find by that card's most expensive row and marks the charge `unknownModel` — the built-in official table lists only the three DeepSeek models, so a CaMeL Hub model is never in it. Nothing in this package notices the disagreement; the ledger's `unknownModel` flag is where it shows.
