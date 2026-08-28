/**
 * Shared readers for the composition suites: the three bundle patch layers of
 * the `sci` profile, the two shipped preset compositions, and the model-visible
 * tool listing a composed row set assembles.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const root = fileURLToPath(new URL('../../../../', import.meta.url))

/** The bundle list `PROFILE_TEMPLATES.sci` must carry, in application order. */
const SCI_BUNDLES: readonly string[] = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-sci',
]

/** Repository path of each bundle's patch file, keyed by the package name the profile lists. */
const BUNDLE_PATCH_FILES: Readonly<Record<string, string>> = {
  '@deepseek-ai/dsh-base': 'packages/bundle/base/cordis.patch.yml',
  '@deepseek-ai/dsh-web-app': 'packages/bundle/web-app/cordis.patch.yml',
  // The profile lists the bundle under its published alias; the workspace
  // directory is `sci-profile` because `packages/sci/*` is one package group.
  '@deepseek-ai/dsh-sci': 'packages/sci/sci-profile/cordis.patch.yml',
}

/**
 * Model-visible tool names a plugin SUBPATH owns, which the generated package
 * map attributes to the package as a whole.
 *
 * The map is keyed by package because that is the unit the catalog documents,
 * but a subpath plugin is separately mountable precisely so a composition can
 * take the tool without the entry, or the entry without the tool — which is
 * the whole point of `sci-tier/suggest` (balanced only) and
 * `tool-subagent-control/list-agents`. Reading the catalog alone would credit
 * the entry row with its subpath's tools and hide exactly that distinction.
 */
const SUBPATH_TOOLS: Readonly<Record<string, readonly string[]>> = {
  '@deepseek-ai/dsh-sci-tier/suggest': ['suggest_tier_upgrade'],
  '@deepseek-ai/dsh-sci-tier/fork': [],
  '@deepseek-ai/dsh-tool-subagent-control/list-agents': ['list_agents'],
}

/** The generated tool package map: package name to the model-visible names it registers. */
function toolPackageMap(): Map<string, string[]> {
  const catalog = readFileSync(join(root, 'docs/tool-catalog.md'), 'utf8')
  const map = new Map<string, string[]>()
  for (const line of catalog.split('\n')) {
    const match = /^\| `(@deepseek-ai\/[^`]+)` \| ([^|]*)\|/.exec(line)
    if (match === null) continue
    const [, packageName, tools] = match
    if (packageName === undefined || tools === undefined) continue
    map.set(packageName, [...tools.matchAll(/`([a-z_0-9]+)`/g)].flatMap(name => name[1] ?? []))
  }
  return map
}

const catalogTools = toolPackageMap()

/** The package half of a plugin specifier (`@scope/name` from `@scope/name/subpath`). */
function packageOf(specifier: string): string {
  const parts = specifier.split('/')
  return parts.slice(0, 2).join('/')
}

/** Every row of a composition, flattened through `cordis:group` children. */
function flattenRows(entries: readonly EntryOptions[]): EntryOptions[] {
  return entries.flatMap(entry => entry.group === true && Array.isArray(entry.config)
    ? [entry, ...flattenRows(entry.config as EntryOptions[])]
    : [entry])
}

/**
 * The model-visible tool names one composed row set assembles.
 *
 * Names come from the generated `docs/tool-catalog.md` package map rather than
 * from a list maintained here, so a package that gains or loses a tool moves
 * this listing without anyone remembering to.
 * @param entries - the rows to read, groups included.
 * @returns every tool name the active rows register, deduplicated and sorted.
 */
export function toolNamesOf(entries: readonly EntryOptions[]): string[] {
  const names = new Set<string>()
  for (const row of flattenRows(entries)) {
    if (row.disabled === true || typeof row.name !== 'string') continue
    const owned = SUBPATH_TOOLS[row.name]
    if (owned !== undefined) {
      for (const name of owned) names.add(name)
      continue
    }
    const packageName = packageOf(row.name)
    if (packageName !== row.name) continue
    const subpathOwned = new Set(Object.entries(SUBPATH_TOOLS)
      .filter(([specifier]) => packageOf(specifier) === packageName)
      .flatMap(([, tools]) => tools))
    // A delegation row's registered name is its own `toolName`, not the
    // catalog's default: the shipped compositions mount the package once per
    // backend, which is why the catalog lists `subagent_fork` as an alias.
    const configured = (row.config as { toolName?: unknown } | undefined)?.toolName
    if (typeof configured === 'string') {
      names.add(configured)
      continue
    }
    for (const name of catalogTools.get(packageName) ?? []) {
      if (!subpathOwned.has(name)) names.add(name)
    }
  }
  return [...names].sort()
}

/** One profile bundle layer: the package name the profile lists and its parsed patches. */
export interface BundleLayer {
  packageName: string
  patches: PatchOptions[]
}

/** The three bundle patch layers of the `sci` profile, in application order. */
export function profileLayers(): BundleLayer[] {
  return SCI_BUNDLES.map(packageName => ({
    packageName,
    patches: loadOverlayPatches('dsh', join(root, BUNDLE_PATCH_FILES[packageName] ?? '')),
  }))
}

/** One shipped preset composition, parsed with the Loader's own YAML dialect. */
function preset(name: string): EntryOptions[] {
  const path = join(root, 'packages/sci/sci-profile/config/agent-presets', name, 'agent.cordis.yml')
  return load(readFileSync(path, 'utf8'), { schema: entryListSchema }) as EntryOptions[]
}

/** The `sci-balanced` preset composition. */
export function balancedPreset(): EntryOptions[] {
  return preset('sci-balanced')
}

/** The `sci-cluster` preset composition. */
export function clusterPreset(): EntryOptions[] {
  return preset('sci-cluster')
}

/** Every row id one preset declares, group children included. */
export function presetRowIds(entries: readonly EntryOptions[]): Set<string> {
  return new Set(flattenRows(entries)
    .map(row => row.id)
    .filter((id): id is string => typeof id === 'string'))
}

/** The ids of the composed host rows that are still active. */
export function activeRows(index: ReadonlyMap<string, EntryOptions>): Set<string> {
  return new Set([...index].filter(([, row]) => row.disabled !== true).map(([id]) => id))
}
