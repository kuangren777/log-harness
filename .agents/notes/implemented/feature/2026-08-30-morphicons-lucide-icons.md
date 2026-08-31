# Agent Note: Morphicons + lucide Icon System for the Web Client

Status: implemented

English | [中文](2026-08-30-morphicons-lucide-icons.zh.md)

## Problem

The web client carried two hand-rolled icon sets that could not animate: `ui-primitives` drew 70 fill-style `ic_ds_*` glyphs (deepsuite figma extracts), and the five `ui-sci-*` packages each redrew stroke glyphs from the design reference. State changes swapped one component for another in a single frame — theme sun/moon, folder open/close, chevron disclosure, copy/check feedback, send/stop, play/pause — with no transition, and the two sets drew in different styles on the same surface.

## Decision

The icon system is now morphicons plus lucide data, per the library's own contract: morphicons is a morph engine without bundled icons, so geometry comes from lucide `IconNode` data (`import { Search } from 'lucide'`).

`ui-primitives/src/icons/stroke.tsx` owns the kernel. `StrokeIcon` renders an `IconNode` as a static stroked SVG (stroke `currentColor`, 1.7 grid-unit stroke width, 24×24 grid). `MorphStrokeIcon` wraps `morphicons/react`'s `MorphIcon` with the same stroke contract — grid units, not `absoluteStrokeWidth`, so morphing and static icons render at equal weight at every size — and `reducedMotion="user"`, so an `icon` prop change springs the path from the old geometry to the new. Every one of the 70 `Icon*` exports keeps its former name, `IconProps` signature, and default size, so no call site changed; fill variants (Like/Dislike Fill, CloseFill) collapse onto their stroke base glyph. `IconTreeCorner8x10` alone keeps custom geometry (a tree elbow has no lucide equivalent), still as stroke data so it stays morphable. The five sci `icons.tsx` files delegate to `StrokeIcon` with re-exported lucide data instead of redrawing paths.

Thirteen state-swap sites moved from component ternaries (or raw inline SVG, in InputBar's send/stop) to a single `MorphStrokeIcon` whose `icon` prop flips: the theme toggle, three folder trees, four chevron disclosures, both copy→check feedbacks, the goal bar's play/pause (two conditional blocks merged into one button), and the input bar's send↔stop. CSS-rotation swaps (triangle expanders, tool-card chevrons) stay as they are — rotation is already animated and morphing a chevron into itself adds nothing.

## Verification

`icons.client.spec.tsx` keeps its structural contract (70 exports, per-glyph default sizes, `currentColor`, no hardcoded palette) and gains kernel coverage: `StrokeIcon` element rendering and undefined-attribute dropping, `MorphStrokeIcon` geometry swap under `reducedMotion="always"` and an explicit spring. The touched packages' suites pass (`ui-primitives`, the five sci packages, `ui-conversation`, `ui-settings-models`, `ui-workspace`, `ui-directory-picker-browse`, `ui-sci-files`, `ui-goal`, `ui-tool`, `ui-settings-general` — 2261 tests), plus `typecheck:contracts-ready` and `lint:contracts-ready`. The `web-card` geometry-identity test survives because `web-row.tsx` renders the shared component rather than a geometry copy.

## Alternatives considered

**Convert the fill geometry to stroke outlines.** Fill-drawn glyphs have no honest stroke equivalent, and morphicons rejects fill-only icons outright; lucide redraws are the supported path.

**Import lucide directly in every consumer package.** Five more dependency edges for identical data; the barrel re-exports the 23 data constants that glyph wrappers and morph sites use, so only `ui-primitives` depends on `lucide` and `morphicons`.

**Morph every swap, including CSS rotations.** A chevron rotated by a class flip already animates; routing it through the morph engine would replace a compositor transform with per-frame path interpolation for no visible gain.

## Consequences

All icons are now stroke-style at 1.7 grid units; the visual delta from the old fill glyphs is intentional and sitewide. New icons join as one-line wrappers with a lucide mapping, and new state swaps should flip a `MorphStrokeIcon`'s `icon` prop rather than ternary two components. Brand artwork (`FishLogo`, `BrandWordmark`, `SciLogo`, `StateDot`) is untouched by design. The 70-name export surface is load-bearing for the count test; dropping dead exports (LikeFill/DislikeFill are unused) is deferred to a hygiene pass.
