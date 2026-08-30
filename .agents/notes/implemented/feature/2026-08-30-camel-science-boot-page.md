# Agent Note: CaMeL Science Boot Page

Status: implemented

English | [中文](2026-08-30-camel-science-boot-page.zh.md)

## Problem

The framework-free boot page rendered a `HARNESS` wordmark over a 20px rotating arc. That is the shipped harness identity, not the product identity this deployment presents: `ui-brand-sci` replaces every brand slot with the CaMeL Science mark, wordmark, and token layer, so the first frame a user sees contradicts every frame after it.

The boot page also cannot import that plugin. It runs before the browser plugin tree activates precisely so client-bundle and plugin-activation failures stay visible, and React arrives only with the UI renderer. Any brand it shows must be inlined in the kernel.

Two defects surfaced while rebuilding it. The page declared no `font-family`: `ui-brand-sci`'s `sci.css` sets `--dsw-font-family`, but that sheet mounts with the plugin, so the boot page fell through to the browser's default serif. And a viewport-wide radial wash bands into visible concentric rings under 8-bit quantisation.

## Decision

The boot page presents CaMeL Science directly. It draws the orbit glyph — three ellipses rotated 0°/60°/120° around a filled nucleus, geometry identical to `ui-brand-sci`'s `SciLogo` — as inline SVG built through `createElementNS`, the two-weight `CaMeL Science` wordmark, a determinate progress track, and an activated/roster count beside the unchanged `Loading plugins…` hint. A drifting two-blob aurora wash sits behind the card.

Progress moves from a rotating arc to a monotonic track. `updateProgress` writes `--dsh-boot-progress` as a percentage floored at 8%, so the fill is visible before the first activation and never walks backwards; the count renders empty until `setTotal` arrives. The `data-dsh-boot-spinner` hook stays on the glyph so hydration keeps identifying the same node across the UI-renderer handoff.

The palette is inlined as `--dsh-boot-*` fallbacks matching `SCI_TOKENS`, with `--dsw-*` reads layered in front so the page adopts real tokens without a reflow once the theme layer lands. Two values are deliberately not read from the plugin: the font stack is declared with its own Apple-first fallback list, and the aurora opacity stays kernel-owned because `--dsw-sci-aurora-opacity` is tuned for panel-sized surfaces and would jump the wash mid-boot.

A static `feTurbulence` tile above the wash dithers away the gradient banding. A halted boot sets `data-dsh-boot-failed` on the root, which stops the glyph's spin, orbit glow, and nucleus pulse — motion on a dead roster reads as progress — while the wash keeps drifting. The failure report gains a hairline card, an error dot, and a title, and still lists each failed entry id and the sweep text verbatim in the code font.

## Verification

`boot-page.client.spec.ts` covers the loading skeleton's wordmark and hint, the glyph's `viewBox` and element counts, monotonic `--dsh-boot-progress` across `8%` / `54%` / `100%` with spinner-node identity preserved through a `loading` update, the activated/roster count, failed-entry listing, the `data-dsh-boot-failed` flag, the complete sweep report, and disposal. The three states were also rendered in Chromium at 1280×800 in both schemes; the serif fallback, the gradient banding, and an animating failure state were each found and fixed there, not in the unit tests.

`apps/web/tests/settings-chrome.e2e.ts` matches `Loading plugins…` exactly, so the count is a sibling element rather than appended text.

## Alternatives considered

**Import `ui-brand-sci`'s `SciLogo` instead of inlining the geometry.** It is a React component in a dynamically loaded plugin; the boot page exists to survive that plugin failing to load. The geometry is duplicated deliberately, and both copies name the other.

**Read `--dsw-font-family` with no fallback list.** That is the defect being fixed: the variable is defined by a sheet that mounts with the plugin, so the boot page must carry the stack itself.

**Keep the rotating arc.** An indeterminate spinner cannot express roster progress, and the arc's `72deg`–`288deg` range read as a stalled circle rather than a fraction of a known total.

**Blur the aurora to hide banding.** `filter: blur(40px)` over the gradient made the rings stronger, not weaker. A noise tile removes them at one paint.

## Consequences

The boot page now carries product branding that the kernel must maintain: a change to `SciLogo`'s geometry, `BRAND_NAME`, or the grounds and accents in `SCI_TOKENS` has to be mirrored here, and nothing gates that. The count and the exact `Loading plugins…` string are load-bearing for the Chromium e2e match. `--dsh-boot-arc` is gone; `--dsh-boot-progress` replaces it.
