/**
 * Artifact resolution against the real fetched runtime. The paths are anchored
 * on the package root rather than on the importing module, so the same
 * constants have to resolve whether the caller reached them from `src` (here)
 * or from the built `lib/index.js` bundle in a deployment.
 */

import { existsSync, statSync } from 'node:fs'
import { dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  GATEWAY_ENTRY,
  PLUGIN_NODE_MODULES,
  RENDER_MACHINE_ROOT,
  UNIT_CONTENT_WORKER_ENTRY,
  VIEWER_ROOT,
} from '../src/host/artifacts/paths.ts'

const PACKAGE_ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

/** The artifacts are fetched, not committed, so a clean checkout has none yet. */
const fetched = existsSync(GATEWAY_ENTRY)
const whenFetched = fetched ? it : it.skip

describe('artifact paths', () => {
  it('anchors every artifact on the package root, not on the importing module', () => {
    for (const path of [GATEWAY_ENTRY, VIEWER_ROOT, UNIT_CONTENT_WORKER_ENTRY, RENDER_MACHINE_ROOT]) {
      const within = relative(PACKAGE_ROOT, path)
      expect(within.startsWith('..')).toBe(false)
      // Reaching the artifacts through `src/host/artifacts/` would mean the
      // built bundle at `lib/index.js` resolved somewhere else entirely.
      expect(within.split(sep)[0]).toBe('artifacts')
    }
    expect(relative(PACKAGE_ROOT, PLUGIN_NODE_MODULES).split(sep)[0]).toBe('node_modules')
  })

  whenFetched('finds the fetched Gateway, worker, Viewer, and render machine on disk', () => {
    expect(statSync(GATEWAY_ENTRY).isFile()).toBe(true)
    expect(statSync(UNIT_CONTENT_WORKER_ENTRY).isFile()).toBe(true)
    expect(statSync(VIEWER_ROOT).isDirectory()).toBe(true)
    expect(statSync(RENDER_MACHINE_ROOT).isDirectory()).toBe(true)
    // The Viewer's entry document is what the reverse proxy serves first.
    expect(existsSync(`${VIEWER_ROOT}index.html`)).toBe(true)
  })
})
