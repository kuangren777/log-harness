/**
 * Complete a `pnpm deploy` output into a tree the harness can actually boot.
 *
 * Two gaps have to be closed, and they compound:
 *
 *   1. `pnpm deploy` walks `dependencies`, while every harness package declares
 *      its workspace edges as peerDependencies (the repository convention —
 *      CLAUDE.md states it for `@deepseek-ai/cordis` and all 241 follow it). The
 *      deployed closure therefore stops at the app's direct dependencies, and
 *      the Service Definitions reached only through a peer edge never arrive.
 *   2. Whatever arrives must sit at the TOP LEVEL of `node_modules/@deepseek-ai/`,
 *      because `healProfilesModuleFallback` builds `$DSH_HOME/profiles/node_modules`
 *      from what it finds there. A package reachable only deeper in the store is
 *      invisible to a profile, which is where plugins are imported from.
 *
 * Workspace packages are copied as real directories: their own peers resolve
 * through the same top level. Third-party packages are RE-LINKED into the
 * carried pnpm store rather than copied, because a package severed from its
 * store entry loses its own dependency tree (`e2b` → `openapi-fetch` is the one
 * that fails first). The relative link a package directory holds cannot simply
 * be moved: its depth is wrong at the destination, so the target is resolved
 * and a correct link is written instead.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readlinkSync, realpathSync, statSync, symlinkSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { createRequire } from 'node:module'

const SRC = process.argv[2] ?? '/src'
const OUT = process.argv[3] ?? '/out'
const outModules = join(OUT, 'node_modules')
const scoped = join(outModules, '@deepseek-ai')

/** Copy pnpm's content-addressed store so every real path a link needs exists. */
function carryStore() {
  const from = join(SRC, 'node_modules', '.pnpm')
  if (!existsSync(from)) return 0
  const to = join(outModules, '.pnpm')
  mkdirSync(to, { recursive: true })
  cpSync(from, to, { recursive: true, verbatimSymlinks: true })
  return readdirSync(to).length
}

/** Every workspace manifest, by package name. */
function workspaceDirs() {
  const require = createRequire(join(SRC, 'noop.js'))
  const found = new Map()
  for (const group of ['packages', 'vendor']) {
    const root = join(SRC, group)
    if (!existsSync(root)) continue
    const leaves = group === 'packages'
      ? readdirSync(root).flatMap(g => {
          const dir = join(root, g)
          return statSync(dir).isDirectory() ? readdirSync(dir).map(p => join(dir, p)) : []
        })
      : readdirSync(root).map(p => join(root, p))
    for (const dir of leaves) {
      const manifest = join(dir, 'package.json')
      if (!existsSync(manifest)) continue
      try {
        const { name } = require(manifest)
        if (typeof name === 'string' && name.startsWith('@deepseek-ai/')) found.set(name, dir)
      } catch { /* a leaf without a readable manifest is not a package */ }
    }
  }
  return found
}

/** Fill in the workspace packages the deploy closure missed. */
function backfillWorkspace() {
  mkdirSync(scoped, { recursive: true })
  let added = 0
  for (const [name, dir] of workspaceDirs()) {
    const target = join(scoped, name.slice('@deepseek-ai/'.length))
    if (existsSync(target)) continue
    mkdirSync(target, { recursive: true })
    for (const part of ['package.json', 'lib', 'src']) {
      const from = join(dir, part)
      if (existsSync(from)) cpSync(from, join(target, part), { recursive: true })
    }
    added += 1
  }
  return added
}

/**
 * Re-link a third-party package into the carried store.
 * @param name - the package name as it appears in a node_modules directory.
 * @param linkPath - the existing entry, a relative symlink into the store.
 * @returns whether a link was written.
 */
function relinkThirdParty(name, linkPath) {
  const destination = join(outModules, name)
  if (existsSync(destination)) return false
  let real
  try { real = realpathSync(linkPath) } catch { return false }
  const marker = `${'node_modules'}/.pnpm/`
  const index = real.indexOf(marker)
  if (index === -1) {
    cpSync(linkPath, destination, { recursive: true, verbatimSymlinks: true })
    return true
  }
  const withinStore = real.slice(index + marker.length)
  const storeTarget = join(outModules, '.pnpm', withinStore)
  if (!existsSync(storeTarget)) return false
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(relative(dirname(destination), storeTarget), destination)
  return true
}

/** Walk every node_modules the workspace produced and surface its third-party entries. */
function backfillThirdParty() {
  const roots = [join(SRC, 'node_modules'), ...[...workspaceDirs().values()].map(d => join(d, 'node_modules'))]
  let added = 0
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root)) {
      if (entry.startsWith('.') || entry === '@deepseek-ai') continue
      const path = join(root, entry)
      if (entry.startsWith('@')) {
        for (const inner of readdirSync(path)) {
          if (relinkThirdParty(`${entry}/${inner}`, join(path, inner))) added += 1
        }
        continue
      }
      if (relinkThirdParty(entry, path)) added += 1
    }
  }
  return added
}

const store = carryStore()
const workspace = backfillWorkspace()
const thirdParty = backfillThirdParty()

const require = createRequire(join(OUT, 'noop.js'))
// Top-level probes: what a profile must be able to import. `openapi-fetch` is
// deliberately absent — it is e2b's own dependency and belongs inside the store,
// so it is probed from e2b instead, which is the resolution that actually runs.
const probes = [
  '@deepseek-ai/dsh-timeout', '@deepseek-ai/dsh-fs', '@deepseek-ai/dsh-workflow',
  '@deepseek-ai/dsh-sci-profile', '@deepseek-ai/dsh-dormice', 'e2b',
]
const missing = probes.filter(name => {
  try { require.resolve(`${name}/package.json`); return false } catch { return true }
})
try {
  const e2bRoot = dirname(require.resolve('e2b/package.json'))
  createRequire(join(e2bRoot, 'noop.js')).resolve('openapi-fetch/package.json')
} catch {
  missing.push('openapi-fetch (from e2b)')
}
if (missing.length > 0) {
  console.error(`complete-deploy-tree: unresolvable from ${OUT}: ${missing.join(', ')}`)
  process.exit(1)
}
console.log(
  `complete-deploy-tree: store ${store} entries, +${workspace} workspace, +${thirdParty} third-party, `
  + `${readdirSync(scoped).length} @deepseek-ai packages, ${probes.length} probes resolve`,
)
