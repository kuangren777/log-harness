# `@deepseek-ai/dsh-web-frontend`

English | [中文](README.zh.md)

The Vite build over the [`dsh-client-web`](../../packages/client/web/README.md) shell library. It is not a standalone application: bare `vite dev` and `vite preview` fail on purpose, because only the Host can inject `window.__DSH_BOOT__`. From a checkout, run `pnpm dsh web`; the built `dist/` is what an installed `dsh web` serves.

[`src/main.ts`](src/main.ts) finds the mount point, starts `AppWebEntry`, and asks for the app-shell service worker. Everything else — module-table seeding, the boot page, the UI-renderer handoff — belongs to the shell library.

## Installing it to a home screen

Every dsh deployment serves its own installable Progressive Web App from its own origin. [`public/manifest.webmanifest`](public/manifest.webmanifest) declares a standalone, portrait application whose theme and background colours are the light theme's `--dsw-alias-bg-base`; the runtime `<meta name="theme-color">` that follows the user's chosen theme is written by ui-layout's theme presenter, which is why [`index.html`](index.html) carries no static one to outrank it. The icon set is generated from [`public/favicon.svg`](public/favicon.svg): 192 and 512 `any` tiles, a 512 `maskable` variant whose mark stays inside the 80% safe circle, and a 180px `apple-touch-icon.png`, because iOS reads neither the manifest's icons nor its display mode. `viewport-fit=cover` is what makes `env(safe-area-inset-*)` resolve to anything but zero, and the shell frame pads itself with those insets.

[`public/sw.js`](public/sw.js) caches the application shell so a launch without a network still opens a page. It is hand-written and shipped verbatim rather than built, so its URL stays `/sw.js` across deployments and the browser's byte comparison can detect an update. It **never** answers for anything under `/api` — the prefix carrying every RPC call and both event downlinks — because a cached answer there would report a session, an approval or a permission state the Host no longer holds; an error is the correct offline answer, and a confident wrong one is not. Navigations are network-first, so an online page always receives the freshly deployed document and the cache is only ever the offline fallback. The worker takes over with `skipWaiting` plus `clients.claim` and does **not** reload the page: a redeployed worker replaces the installed one immediately instead of waiting for every tab to close, without dropping a running turn's interface state.

Registration happens only where the browser allows one — `https:`, or a loopback hostname over plain http ([`src/service-worker-registration.ts`](src/service-worker-registration.ts)). A deployment reached over plain http on a LAN address therefore runs online-only and offers no install prompt. That is the browser's rule, not this application's.

## One app per origin

A PWA is bound to the origin it was installed from, and this deployment's session cookie is `SameSite=Strict`. An app installed from server A therefore cannot authenticate to server B: the cookie would not be sent, and the installed scope would not cover B in any case. There is deliberately no cross-origin "server URL" setting, because no such setting could work.

The supported shape is the other way round: every dsh deployment serves its own installable app, and each installed app keeps its own cookie for its own origin. Switching servers means navigating to the other origin — and installing that one too, if it is a place you return to. An in-app list of recently used origins would navigate to them, never proxy them.
