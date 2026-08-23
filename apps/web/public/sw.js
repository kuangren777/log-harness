/*
 * DSH app-shell service worker.
 *
 * Hand-written and shipped verbatim from public/, not built: the browser
 * compares this file byte-for-byte against the installed copy to decide
 * whether an update exists, so its URL must stay `/sw.js` across deployments.
 * A classic worker, not a module worker, because module workers still are not
 * universal.
 *
 * WHAT IT CACHES: the application shell only — the document, the manifest and
 * the icon set at install, plus the hashed build assets as they are first
 * requested. Hashed names make a stale asset impossible: a new build asks for
 * a new URL.
 *
 * WHAT IT NEVER TOUCHES: anything under `/api`. That prefix carries every RPC
 * call and both event WebSocket downlinks (dsh-client-connection's
 * api-path.ts), and a cached answer there would report a session, an approval
 * or a permission state that this Host no longer holds. An error is the
 * correct offline answer for those; a confident wrong one is not.
 *
 * UPDATE STRATEGY: skipWaiting plus clients.claim, with NO forced reload. A
 * redeployed worker therefore takes over immediately rather than waiting for
 * every tab to close, and because navigations are network-first, an online
 * page always receives the freshly deployed document — the cache is the
 * offline fallback, never the online answer. The page is not reloaded out
 * from under a running turn; the next navigation picks the new shell up.
 */

/** Cache name; bump to invalidate every shell entry at once. */
const CACHE = 'dsh-shell-v1'

/** Path prefix owning every RPC call and event downlink — never cached, never intercepted. */
const API_PATH = '/api'

/** Fetched and cached at install so a cold offline launch has a document to open. */
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
]

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter(name => name !== CACHE).map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

/**
 * Whether this worker may answer a request at all. Everything it declines
 * falls through to the network untouched, which is the only correct handling
 * for live Host state.
 */
function isShellRequest(request, url) {
  if (request.method !== 'GET') return false
  if (url.origin !== self.location.origin) return false
  if (url.pathname === API_PATH || url.pathname.startsWith(`${API_PATH}/`)) return false
  return true
}

/** Network-first, so an online page never opens a stale shell; cache is the offline fallback. */
async function navigationResponse(request) {
  try {
    return await fetch(request)
  } catch (offline) {
    const cached = await caches.match('/')
    if (cached !== undefined) return cached
    throw offline
  }
}

/** Cache-first for build assets: their names carry a content hash, so a hit is never stale. */
async function assetResponse(request) {
  const cached = await caches.match(request)
  if (cached !== undefined) return cached
  const response = await fetch(request)
  // Only same-origin successes are worth keeping; an opaque or error response
  // cached here would be replayed as the app's own answer.
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE)
    await cache.put(request, response.clone())
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (!isShellRequest(event.request, url)) return
  event.respondWith(event.request.mode === 'navigate'
    ? navigationResponse(event.request)
    : assetResponse(event.request))
})
