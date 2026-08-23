import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
  // env(safe-area-inset-*) resolves to zero without viewport-fit=cover, which
  // would put the composer under the home indicator on a notched phone.
  expect(index).toContain('viewport-fit=cover')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'DeepSeek Harness',
    short_name: 'DSH',
    description: 'Agent harness client: run and steer agent sessions against this deployment.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // The light theme's --dsw-alias-bg-base; ui-layout's ThemePresenter
    // rewrites the live meta[name=theme-color] once a theme resolves.
    theme_color: '#ffffff',
    background_color: '#ffffff',
    icons: [
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  })

  // Every icon the manifest and the iOS metadata name must actually ship.
  for (const asset of ['favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
    expect((await stat(join(DIST_ROOT, asset))).size).toBeGreaterThan(0)
  }
})

it('ships the iOS install metadata the manifest cannot carry', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  // iOS reads neither `display` nor `icons` from the manifest.
  expect(index).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
  expect(index).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />')
  expect(index).toContain('<meta name="mobile-web-app-capable" content="yes" />')
  expect(index).toContain('<meta name="apple-mobile-web-app-title" content="DSH" />')
  expect(index).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="default" />')
  // The presenter owns the live theme-color node; a static one earlier in the
  // document would outrank it for the whole session.
  expect(index).not.toContain('name="theme-color"')
})

it('ships an app-shell worker that never answers for Host state', async () => {
  const worker = await readFile(join(DIST_ROOT, 'sw.js'), 'utf8')
  // The one rule that must survive every future edit: a cached RPC or event
  // answer would report a session state this Host no longer holds.
  expect(worker).toContain("const API_PATH = '/api'")
  expect(worker).toContain('if (url.pathname === API_PATH || url.pathname.startsWith(`${API_PATH}/`)) return false')
  // Only content-hashed names may be answered from the cache first; a stable
  // URL served that way outlives the deployment that produced it.
  expect(worker).toContain("const HASHED_ASSET_PATH = '/assets/'")
  expect(worker).toContain('if (url.pathname.startsWith(HASHED_ASSET_PATH)) {')
  // Update strategy: immediate takeover, no waiting worker left serving the
  // previous shell after a redeploy.
  expect(worker).toContain('self.skipWaiting()')
  expect(worker).toContain('await self.clients.claim()')
})

it('ships a favicon that switches to a light mark under dark color scheme', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  // The light fill must live inside the dark-scheme media query, so the icon
  // stays black in light mode and only turns white under a dark scheme.
  expect(favicon).toMatch(/@media \(prefers-color-scheme: dark\)\s*{\s*path\s*{[^}]*fill:\s*#fff/i)
  expect(favicon).toContain('fill="#000"')
})
