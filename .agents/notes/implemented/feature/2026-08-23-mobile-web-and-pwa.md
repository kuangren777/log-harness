# Agent Note: The client on a phone, and the app you install from one origin

Status: implemented

English | [中文](2026-08-23-mobile-web-and-pwa.zh.md)

## Problem

The web client was drawn for a cursor on a wide screen. At 390x844 the three-column frame gave the conversation whatever the 56px sidebar rail left it, the settings dialog kept a 188px navigation rail beside a content column too narrow for one settings row, controls sat at their 28–36px cursor sizes, the rail's expand affordance appeared on hover — which a finger never produces — and `height: 100%` resolved against the large viewport, so the composer began life under the browser's own chrome. There was no service worker and the manifest was a four-line stub with one SVG icon, so the tailnet deployment could not be installed to a home screen at all.

## Decision

### One breakpoint, and above it nothing changes

`PHONE_MAX_WIDTH = 640` (ui-layout `columns.ts`). At or below it AppFrame leaves the three-column form entirely rather than shrinking it: one full-width conversation track under a bar carrying the drawer toggle, the details column out of the flow, and the sidebar rendered wide inside an off-canvas drawer. 640 sits above both phone targets and below the narrowest tablet portrait width, so the existing 1024px rail auto-collapse and every wide-form rule are untouched. CSS modules in other packages restate the literal, because a custom property cannot be read in a media query; the constant is the authority and each restatement names it.

### The drawer is the sidebar's existing toggle, not a second switch

Below 1024 the layout store already has `narrowExpanded`, the manual override that re-expands an auto-collapsed sidebar. The drawer is that flag. The header toggle, the sidebar's own collapse control and `ctx.layout.toggleSidebar()` therefore remain one switch that cannot disagree with itself, and no new store state exists to keep in sync.

Modality is real: Escape, a backdrop tap and the toggle all close it, Tab cycles inside it (`drawer.ts` holds the two pure decisions), entering lands on the first control, and closing returns focus to whatever opened it — unless focus has already left the drawer, in which case taking it back would be the rude thing. The parked drawer is removed from the tab order by `visibility: hidden`, switched at the end of the slide-out and the start of the slide-in so neither direction hides the animation; a transform alone would have left an invisible column full of tab stops.

### The drawer slides with `left`, not a transform

A transformed ancestor becomes the containing block for `position: fixed` descendants. ui-settings renders its full-viewport panel as a descendant of the sidebar column, so with `transform: translateX(0)` on the drawer the settings dialog came out 280px wide instead of 390 — the phone journey caught exactly that. AppFrame already solves the drawer width in px, so it supplies both the width and the parked/open `left` inline and the transition rides that property.

### dvh, because the keyboard is part of the viewport

`html`, `body` and `#root` move to `100dvh` behind `@supports`, with the percentage as the fallback. A percentage resolves against the *large* viewport — URL bar retracted — so the frame's bottom row, the composer, starts underneath browser chrome and stays there until the user scrolls. The dynamic unit tracks the visible viewport as that chrome and the on-screen keyboard move it. `svh` was the alternative: stable, never reflowing, and permanently short by the height of the URL bar, which shows the page background under the app. `dvh` reflows when the chrome moves, and that is the cost taken.

Safe-area insets are applied once, on the frame, its bar, the drawer and the centre column — the only boxes that touch the display edges — and `viewport-fit=cover` in the document is what makes those insets resolve to anything but zero.

### Tap targets are a pointer question, not a width question

44px is applied under `@media (pointer: coarse)`, which is true for a touch-primary device and false for a touchscreen laptop driven by a mouse. It reaches the shared `Button` default size and `Input`, the composer's attach/send circles and mode chips, the sidebar's wide-form controls, and the settings close button and nav cells. The compact `sm` button and the 56px rail's 36px boxes deliberately keep their sizes: a 44px control does not fit a 56px column, and growing a control designed for a dense row breaks the row rather than helping the finger. Under `(hover: none)` the rail's hover-revealed expand icon becomes unconditional, because hover never arrives there.

### `/api` is never cached, and the worker never waits

`public/sw.js` is hand-written and shipped verbatim from `public/`, so its URL stays `/sw.js` across deployments and the browser's byte comparison can detect an update. It precaches the document, manifest and icons at install and caches hashed build assets as they are first requested — a hashed name cannot go stale, because a new build asks for a new URL.

It declines every request under `/api`, the prefix carrying every RPC call and both event WebSocket downlinks. A cached answer there would report a session, an approval or a permission state the Host no longer holds; offline, an error is the correct answer and a confident wrong one is not.

Update strategy is **`skipWaiting` plus `clients.claim`, with no forced reload**. Immediate takeover is what stops a redeployed origin from being served the previous shell until every tab closes. The reload is deliberately absent: navigations are network-first, so an online page already receives the freshly deployed document and the cache is only ever the offline fallback — the shell cannot be stale while online, and a `controllerchange` reload would only cost a running turn's interface state. The next navigation picks the new shell up.

Registration happens only on `https:` or a loopback hostname, because that is where the browser exposes `navigator.serviceWorker` at all. A deployment on a plain-http LAN address runs online-only with no install prompt; that is the browser's rule, recorded rather than worked around.

### A PWA belongs to one origin — the constraint, not a bug to route around

An installed app is bound to the origin it was installed from, and this deployment's session cookie is `SameSite=Strict`. An app installed from server A therefore cannot authenticate to server B: the cookie would not be sent, and the installed scope would not cover B in any case. No cross-origin "server URL" field was added, because none could work.

The supported shape is the inverse: every dsh deployment serves its own installable app, each keeping its own cookie for its own origin. A future list of recently used origins would *navigate* to them, never proxy them. This is stated in `apps/web/README.md`, which is where someone looking for that setting will look.

## Alternatives considered

**A floating toggle over the conversation header.** Rejected: the conversation header is hidden in the hero phase, so the control would vanish exactly when a new user first needs the sidebar. A 44px bar costs vertical space and always exists.

**Building the service worker through Vite.** Rejected: a service worker must not be a hashed filename, and a module worker is still not universal. A second rollup entry would also let shared chunks split out from a worker that cannot import them.

**An explicit update prompt.** Rejected for now: it needs product copy and a surface in a package, and network-first navigation already makes a stale online shell impossible. The strategy is recorded here so a later prompt replaces a documented choice rather than an accident.

**Bumping every control to 44px on width alone.** Rejected: a narrow desktop window driven by a mouse does not need a finger-sized control, and `(pointer: coarse)` names the actual condition.

## Consequences

Desktop is byte-identical: every new rule is behind `max-width: 640px`, `pointer: coarse`, `hover: none`, or the `data-phone` attribute the frame only sets below the breakpoint. No existing golden moved.

What a phone still does not get: iOS Safari does not resize the layout viewport for the on-screen keyboard, so `dvh` does not shrink there and the composer relies on Safari scrolling the focused textarea into view — Chrome on Android does resize, and behaves as designed. The settings dialog's phone form stacks the close button over the nav band rather than reflowing the header, and the section bodies themselves were not re-laid out; a wide settings row still scrolls inside its own container. `ui-workspace`'s session rows keep whatever hover affordances they had — that package was outside this change.
