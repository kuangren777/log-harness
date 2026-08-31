/**
 * Absolute paths of the prebuilt Univer runtime artifacts this package ships
 * beside its own code (`artifacts/`, fetched by `pnpm run fetch-artifacts`).
 * Reconstructed 2026-08-30 from the published bundle after the untracked
 * original was destroyed by a stray symlink; the `artifacts/` gitignore rule
 * also matched this SOURCE directory, which is why git held no copy. The
 * declarations and JSDoc match the shipped `lib/types/host/artifacts/paths.d.ts`
 * verbatim.
 * @module @deepseek-ai/dsh-office-univer/src/host/artifacts/paths
 */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * This package's own root directory. Every artifact path hangs off it because
 * the two planes reach this module from different depths: from `src` the
 * importer is `src/host/artifacts/paths.ts`, from the built bundle it is
 * `lib/index.js`. Walking up to the nearest `package.json` lands on the package
 * root either way, so `artifacts/` resolves to one physical directory whether
 * tests run against sources or a deployment runs against `lib`.
 */
const PACKAGE_ROOT = packageRoot(fileURLToPath(import.meta.url))

/** Bundled Gateway executable, fetched by `pnpm run fetch-artifacts`. */
export const GATEWAY_ENTRY = join(PACKAGE_ROOT, 'artifacts', 'gateway.cjs')

/** Bundled Viewer assets served by the Gateway. */
export const VIEWER_ROOT = join(PACKAGE_ROOT, 'artifacts', 'viewer') + '/'

/**
 * The Viewer's own chunk directory. Its files are also served directly by the
 * host, because the Viewer's module-preload helper addresses them as absolute
 * `/assets/<name>` paths the reverse proxy never sees.
 */
export const VIEWER_ASSETS_ROOT = join(VIEWER_ROOT, 'assets')

/** Bundled one-shot worker used for content import, inspection, execution, export, and render-source reads. */
export const UNIT_CONTENT_WORKER_ENTRY = join(PACKAGE_ROOT, 'artifacts', 'unit-content-worker.mjs')

/** Bundled machine-facing page used for layout analysis and text measurement. */
export const RENDER_MACHINE_ROOT = join(PACKAGE_ROOT, 'artifacts', 'render-machine') + '/'

const require = createRequire(import.meta.url)

/** This plugin's node_modules root — the NODE_PATH for spawned worker/gateway processes. */
export const PLUGIN_NODE_MODULES = join(PACKAGE_ROOT, 'node_modules') + '/'

/** Native formula binding package root, resolved from the plugin's dependencies. */
export const FORMULA_BINDING_ROOT = dirname(require.resolve('@univerjs-pro/engine-formula-rust-binding'))

/**
 * Walk up from one module file to the directory owning it.
 * @param from - absolute path of the importing module.
 * @returns the nearest ancestor directory containing a `package.json`.
 * @throws {Error} when no ancestor carries a manifest, which would mean the
 * package was deployed without its own `package.json`.
 */
function packageRoot(from: string): string {
  let cursor = dirname(from)
  for (;;) {
    if (existsSync(join(cursor, 'package.json'))) return cursor
    const parent = dirname(cursor)
    /* v8 ignore next -- filesystem-root arm: this module is always imported from
     inside the published package, which carries the manifest the walk looks for. */
    if (parent === cursor) throw new Error(`dsh-office-univer: no package.json above ${from}`)
    cursor = parent
  }
}
