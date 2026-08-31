# Agent Note: the model menu carries a price, without learning what a price is

Status: implemented

English | [中文](2026-08-31-model-row-price-hints.zh.md)

## Problem

The `sci` deployment now sells a catalog its institutions curate, at rates each institution sets: the gate owns a model pool with published prices and a per-institution resale multiplier, and `dsh-sci-models` already makes that catalog decide which models a session may call. What a model costs stayed invisible. A researcher picking between a flash tier and a pro tier in the composer's model menu was choosing between two names, while the difference between them is a factor of three on every token they are about to spend.

The obvious place to show it is the menu row, and the menu belongs to `ui-model-selection` — a package that knows nothing about gates, institutions, or money, and must not start to. The seat's injected face is also not a free surface: the client stack's props discipline admits plain serializable data and callbacks and routes rendered content through slots, so "let the sci package pass a ReactNode" was never available.

## Decision

`ui-model-selection` grows one generic seam and no vocabulary. `ctx.modelDirectories.registerHints(source)` takes one source at a time — a second registration while one stands throws rather than leaving the occupant to registration order — and returns its disposer. A source answers with `ModelHint` rows: a provider id, a model id, and `lines`, already-localized plain strings. The seat reads whichever source stands when it mounts, asks it once, and places the lines of the row whose provider and model match exactly. Nothing in that package reads the text, and a composition with no source renders the menu it rendered before.

The lines ride the shared `Tooltip` primitive rather than a CSS-only layer inside the menu card. The card clips: `.menu` is `overflow: hidden` for its rounded surface and sticky group headings, and `.groups` scrolls, so a bubble positioned inside a row would be cut off at the first row it needed to overflow. `Tooltip` is `position: fixed` off the anchor's rect, which is exactly the escape that already carries the sidebar rail's labels. Every row anchors one, hinted or not, with `disabled` toggling the bubble: Tooltip's disabled anchor is the same element with the same DOM, so a hint arriving while the menu is open reaches the row that is already standing instead of remounting it. Because a hover bubble is not readable by someone who never hovers, the same lines also render in a visually hidden element outside the button, which the row names through `aria-describedby` — outside, because inside the button the text would join the row's accessible name, and the row is named by its model.

`ui-sci-conversation` contributes the one source this product has. It reads `GET /gate/api/models` — cookie-authenticated against the same origin sci-gate serves the page from, so no credential enters the browser code — and turns each priced row into the published input, output, and cache-hit prices in USD per million tokens at four decimals, plus, only where the institution resells at a rate other than 1.000, that multiplier and what it charges. The multiplier is applied to the integer micro-USD amount before the display rounding, so the quoted effective price comes off the same arithmetic the charger bills with. The row's gate `route` is used directly as the client-side provider id, because `dsh-sci-models` registers `camel-api` and `deepseek-official` under those same strings; a route this build has no provider for simply matches no row. The registration sits in its own `ctx.inject(['modelDirectories'])` fork rather than in the plugin's requirements, so a composition without the model menu loses the price lines and nothing else.

The peak schedule the same gate answer publishes is deliberately not quoted. It is a clock-dependent discount, and a number that changes with the hour, shown where a reader is comparing models, would read as the price of the model.

## Alternatives considered

**A `modelHint` injected member returning a `ReactNode`.** Rejected on the client stack's own rules: injected faces carry JSON-compatible data and callbacks, and rendered content travels through slots. Plain lines also make the seam testable as data and keep every rendering decision — tooltip, description, ordering — in the package that owns the menu.

**A CSS `:hover` layer inside the option row.** Rejected because the menu card clips it. Reproducing the escape by hand would have meant re-deriving `Tooltip`'s fixed positioning, viewport fit, and hover/focus pairing inside this one menu.

**Let `ui-model-selection` read the gate itself.** Rejected: it is the harness's own model selector, shipped in compositions that have no gate, no institution, and no money. A price is a sci deployment fact, and the package that already reads the gate for identity and balance is the sci layer.

**Push prices down the existing `ModelDirectory` channel from the Host.** Deferred rather than rejected. `dsh-sci-models` holds the same rate card it enforces the catalog with, and routing prices through `session.models` would give the browser one authority instead of two reads. It needs a wire-contract change in `api/remotes` and a Host-side projection; the browser read reaches the same rows today with no protocol change, and the note that introduced `dsh-sci-models` already records the split.

**A hard `inject` dependency from `ui-sci-conversation` on the model service.** Rejected: it would make the conversation skin refuse to load in any composition without the model menu, which is a much larger claim than "show prices where there is a menu to show them in".

## Consequences

A model row in the composer now states what it costs, in the currency and to the digit this deployment shows everywhere else, and states the institution's markup only where there is one. The seam that carries it is contributor-agnostic: another deployment could annotate rows with a quota, a region, or a deprecation date without touching the menu.

Two bounds follow from the design and are recorded in both READMEs. The source is read once per seat mount and nothing polls, so a rate an institution edits reaches an open page on the menu's next mount rather than immediately. And the lines are the list price: the effective charge of the current minute, peak schedule included, stays in the credit ledger, which is the one surface that knows what was actually billed.

## Testing

`ui-model-selection`'s component suite pins the annotated row — the description element the row points at, the bubble's two lines on hover, an unhinted sibling row that keeps no `aria-describedby`, a hint for a model the directory does not list annotating nothing, a rejected source leaving every row bare, and an answer arriving after the seat unmounted changing nothing. Its plugin suite pins the seam on the real service: no `loadHints` on the injected face until a source registers, the exact registered source afterwards, a throwing second registration, and a disposer that only ever releases its own registration. `ui-sci-conversation`'s new suite pins the gate read against an injected fetch — the URL and the same-origin credentials, the four-decimal money and three-decimal multiplier verbatim, the one-line and two-line splits including a discount, every malformed or unpriced row dropped beside a good neighbour, and a refusing, unreachable, or off-format gate reaching the menu as an empty list — and its plugin suite pins the contribution itself, including a composition with no model menu where every other contribution still lands. Per-file coverage over `packages/client/ui-sci-conversation/src` is 100%; the model-selection client files remain under the client lane's standing coverage exemption, with every line added here exercised.
