# dsh-sci-credit

English | [中文](README.zh.md)

The harness half of the self-owned USD billing seam: **the gate keeps the ledger, this plugin meters and refuses.** Design: `ClawsGO-System/13-Billing/00-README.md` (B2), outside this repository; the ledger, the price list, and the payment channels are the gate's (`12-Multi-Tenant/artifacts/sci-gate/`).

Everything runs on one `llm/stream` waterfall listener, because that waterfall is the single seam every model call passes through (`packages/llm/llm/src/index.ts`). Before `next()` it reads the tenant's balance; after the stream settles it prices the usage the adapter reported and posts the charge. Nothing else is metered: tool calls cost no provider tokens, so a spent tenant is stopped at the model boundary and the tools it already asked for are allowed to finish.

## The three steps of one metered call

**Balance.** `GET /gate/api/credit/balance` with the VM bearer token, reusing an answer younger than `balanceTtlMs` (default 2 s) and coalescing concurrent reads onto one request — a tool loop issues model calls a second apart and would otherwise spend a round trip per step re-asking the same question. `exhausted` (both the plan and the purchased pool spent) refuses the call **without calling `next()` at all**, so the refusal costs zero provider tokens. A gate that cannot answer refuses the same way under the default `failMode: 'closed'`; `failMode: 'open'` admits the call and reports the outage at most once per `degradedLogIntervalMs`. A delivered charge invalidates the cached balance, because a stale answer would admit calls a tenant can no longer pay for.

**Pass-through.** Every downstream chunk is yielded unchanged and the last `usage` chunk is kept. An adapter that retried inside one call reports the attempt whose response the consumer actually saw, which is why the last one wins rather than the first.

**Charge.** The usage is priced (below) and `POST /gate/api/credit/charge` records it under a per-call UUID. The gate keys idempotency on that `requestId`, so `duplicate: true` is a delivered charge and not a failure. The post is never awaited by the stream: a refused or unreachable gate sends the payload to the spool instead, and the retry loop drains it in the background.

The body carries `priceVersion` and `ratioX1000` so the ledger row describes its own arithmetic. `priceVersion` is the version of the exact price ROW the charge was computed from when the card states one per row, and the card-wide version only when it does not: the gate's price list is append-only per model, so one card can carry rows of different ages and `(model, priceVersion)` is what joins a ledger row to the price it was charged at. `ratioX1000` travels with it because the multiplier is what turns that joined list price into the amount, and it may have changed by the time anyone audits.

## Pricing

Integer arithmetic over `BigInt` throughout — the ledger is integer micro-USD, and a float intermediate would make two identical calls priced on different hosts disagree in the last digit.

| Usage field | Priced at | Why |
|---|---|---|
| `inputTokens` | `missMicros` | Uncached input. `TokenUsage` counts are disjoint, so cache reads are already out of this number (`packages/llm/llm-deepseek/src/translate.ts::mapUsage`). |
| `cacheReadTokens` | `hitMicros` | A cache hit is the cheap input rate — the whole reason the counts are split. |
| `cacheWriteTokens` | `missMicros` | DeepSeek charges a cache write as ordinary uncached input. |
| `outputTokens` | `outMicros` | Completion tokens. |
| `reasoningTokens` | **nothing** | Already inside `outputTokens`: `mapUsage` maps `completion_tokens` straight to `outputTokens` and reports `completion_tokens_details.reasoning_tokens` beside it *without* subtracting, which is the OpenAI-compatible convention the adapter follows. Pricing it again would bill every reasoning token twice. It is still recorded on the charge and the session event, because the ledger row should say what the model spent its output on. |

Each component is `round_half_up(tokens × micros ÷ 1_000_000)`, the four are summed, the peak multiplier is applied to that sum with a half-up rounding, and the row's resale multiplier to that result with another. Rounding once per component and once per multiplier keeps the number reproducible from the ledger row alone; multiplying the prices first would compound a rounding error per component.

**Peak and off-peak** follow the request's START time in UTC: Monday–Friday 01:00–04:00 and 06:00–10:00 are peak at the listed price, and everything else — weekends included — is `offPeakMultiplierX1000` (500, i.e. half). The window start is inclusive and the end exclusive, so `01:00:00` is the first peak second and `10:00:00` the first off-peak one. The schedule comes from the gate's `peak` object when it serves one; a card that states its windows on any clock other than UTC is **refused** rather than read as UTC, because applying UTC windows to another zone's windows would misprice every call in silence.

**The resale multiplier** `ratioX1000` is the only field that states what the platform charges on top of the provider's list price: `1000` resells at cost, `1500` charges 1.5×. It is applied last, to the peak-adjusted total, and is deliberately not folded into the peak multiplier — keeping the two steps separate leaves the official price and the markup separately auditable from one ledger row, and each step rounds half up on its own. A gate that serves rows without the field is read as `1000`, because reselling at the official price is the only safe reading of its silence.

**An unlisted model** is priced by the most expensive row on the card and marked `unknownModel` on both the charge and the session record. Comparison walks output, then uncached input, then cached input, then the model id, so the choice does not depend on card order, and each price is read **after** the row's resale multiplier — that product is what a call on the row would be charged, and comparing list prices would pick a cheaper row whenever a dearer one carries a bigger multiplier. Erring expensive is the safe direction: the alternative is serving an unpriced model below cost until someone notices the ledger.

## Configuration

`vmToken` is required and has no default — it names WHOSE ledger every charge lands in, and a guess would bill another tenant. A blank value fails the load. A deployment with no gate removes the row rather than blanking the token.

`pricing` is either `gate` (default: fetch `GET /gate/api/credit/pricing` at boot, refresh every `pricingRefreshMs`, and keep the built-in official 2026-08 table until the first fetch lands) or an explicit row list, which prices from configuration alone, never asks the gate, and is stamped `priceVersion: 0` so a ledger row says where its price came from. An empty row list fails the load.

`spoolPath` defaults to `$DSH_HOME/.sci/credit-spool.jsonl`. The shipped `sci` profile points it at `$DSH_HOME/sci/credit-spool.jsonl` instead, beside that profile's session index, so one deployment keeps its state in one directory. `creditUrl` (default `/gate/credit`) is the page the refusal sends the user to. `requestTimeoutMs`, `spoolRetryBaseMs`, and `spoolRetryMaxMs` bound one gate call and the doubling drain backoff. Full field list: [config catalog](../../../docs/config-catalog.md#deepseek-aidsh-sci-credit).

## The spool

A charge is money already spent upstream, so losing one is worse than delivering it late. A charge the gate refuses is appended to a JSONL file (`0600` under a `0700` directory) and retried with a doubling delay from `spoolRetryBaseMs` to `spoolRetryMaxMs`. A drain pass stops at the first refusal — a gate refusing one charge will refuse the rest of the pass, and continuing would spend one failed request per queued payload — and the remainder keeps its file order, so the oldest charge is always the next one tried. A truncated tail from a killed process is discarded rather than left to block every later line, and the file is removed once nothing is queued. Delivery is safe to repeat because the gate keys on `requestId`.

## Events

`sci/credit-charged{ requestId, model, usage, usdMicros, priceVersion, peak, ratioX1000, spooled, unknownModel }` records one priced call, appended with the envelope's `ignorable` marker: the model never reads it, nothing later in the log is interpreted differently by its presence, and it exists so an audit projection can reconcile a session against the tenant's ledger — `requestId` is the ledger's `ref` minus its `req:` prefix. `spooled` is true exactly when the gate did not accept the charge and the payload is waiting locally. The record is written even when the charge reached neither the gate nor the spool, with `spooled: false` and an error logged, because a lost charge is the case that most needs to be visible in the log.

The `./invariant` companion asserts that no two `sci/credit-charged` records in one session share a `requestId`: the gate's ledger `ref` is UNIQUE, so a repeat means two metered calls collapsed onto one charge — the tenant paid for one of them, and for the wrong one if the prices differed. The converse (every usage-bearing response has a charge) is deliberately not asserted, because the live stream cannot decide it: the record is appended after the response, a call that ends in an error finish reports usage without producing an `assistant/message` at all, and an undelivered charge legitimately waits in the spool across a restart. That direction is a reconciliation between the log and the ledger, not an assertion over one growing log.

## Model Experience

None, as the metering registers no prompt, tool, or context of its own, and its refusal reaches the user rather than the model: an error finish is raised out of the agent loop as an `LlmError` (`packages/core/agent-loop/src/agent.ts`) and never enters a model request.

#### KV Cache effect

None on an admitted call: chunks pass through unchanged and no request field is rewritten, so the provider prefix the next turn reuses is byte-identical to the one the loop assembled. A refused call is not sent at all, so it materializes no prefix and invalidates none.

## Known Limitations and Deferred Work

- **A charge the gate refuses AND the spool cannot persist is lost.** Both failures together mean the payload exists only in memory; it is reported at error severity with the request id and the amount, and the session record marks it `spooled: false`, but nothing collects it. Closing that would need an in-memory carry-over queue with its own bound, which is deferred until a deployment has actually seen it.
- **The spool does not survive a lost home directory, and is not shared between processes.** Two harness processes on one `$DSH_HOME` would each drain the same file; the appends and drains of ONE process are serialized, but no cross-process lock is taken. The gate's idempotency makes a double drain harmless, not impossible.
- **The balance is read per process, not per session.** One `vmToken` addresses one tenant, so a VM serving several users of that tenant refuses all of them together when the tenant's pools are spent.
- **Refusal is at the model boundary only.** A tool call already dispatched runs to completion, and a sandbox's CPU, storage, and egress are not metered at all — only model tokens are.
- **A retry inside one adapter call is charged once.** The last `usage` chunk wins, so tokens spent by an attempt the adapter discarded are not billed. Loop-level retries are separate `llm/stream` calls and are charged separately, which is the provider's own accounting.
- **The rate card is refreshed on a timer, not on a price change.** A charge issued in the window between a gate price change and the next refresh is priced and stamped at the old version. The stamp is what makes it auditable rather than merely wrong.
- **Only a UTC peak schedule is applied.** A gate that publishes its windows on another clock has its whole card refused, which keeps the previous card in force rather than mispricing; supporting a second zone would need a real timezone database in this package.
