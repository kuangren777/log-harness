/**
 * The `sci` profile as it actually composes: the three bundle patch layers
 * applied through the include's own patch algorithm, exactly as
 * `dsh --profile sci --dump-config` renders them.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { composeEntries, renderConfigDump } from '@deepseek-ai/dsh-app-boot'
import { discoverPresets } from '@deepseek-ai/dsh-agent-presets'
import { PERSONA_NAMES } from '@deepseek-ai/dsh-sci-plan'
import { subagentToolName } from '@deepseek-ai/dsh-sci-tier'
import { afterAll, describe, expect, it } from 'vitest'
import { BUNDLED_PRESET_ROOT, SCI_PRESETS } from '../src/index.ts'
import {
  activeRows,
  balancedPreset,
  clusterPreset,
  presetRowIds,
  profileLayers,
  toolNamesOf,
} from './harness.ts'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const workdir = mkdtempSync(join(tmpdir(), 'dsh-sci-profile-'))

afterAll(() => { rmSync(workdir, { recursive: true, force: true }) })

/** The composed host tree: every row the three bundle layers leave in place. */
const composed: EntryOptions[] = composeEntries([profileLayers().flatMap(layer => layer.patches)])
const rows = new Map(composed.filter(row => typeof row.id === 'string').map(row => [row.id, row]))

describe('the sci bundle patch layer', () => {
  it('moves the filesystem and subprocess seams into the Dormice sandbox and keeps sandbox-local', () => {
    expect(rows.get('fs-sandbox')?.disabled).toBe(true)
    expect(rows.get('subprocess')?.disabled).toBe(true)
    expect(rows.get('fs-e2b')?.name).toBe('@deepseek-ai/dsh-fs-e2b')
    expect(rows.get('subprocess-e2b')?.name).toBe('@deepseek-ai/dsh-subprocess-e2b')
    expect(rows.get('dormice')?.name).toBe('@deepseek-ai/dsh-dormice')
    expect(rows.get('sandbox')?.disabled).toBeUndefined()
  })

  it('points the workspace picker at the sandbox instead of this container', () => {
    // The `-auto` row resolves to a HOST backend, and a host path picked in that
    // browser becomes a session cwd every sandboxed command then fails on. A
    // patch cannot rewrite a row's `name`, so both faces are replaced.
    expect(rows.get('directory-picker')?.disabled).toBe(true)
    expect(rows.get('directory-picker-e2b')?.name).toBe('@deepseek-ai/dsh-host-directory-picker-e2b')
    expect(rows.get('ui-directory-picker-browse')?.name).toBe('@deepseek-ai/dsh-client-ui-directory-picker-browse')
  })

  it('mounts every host-plane science row and no per-agent one', () => {
    const hostPlane = [
      'sci-prompt', 'sci-skills', 'sci-workspace', 'sci-guard', 'sci-credit',
      'sci-memory', 'sci-audit', 'sci-remote-hosts', 'sci-tier-fork',
    ]
    for (const id of hostPlane) expect(rows.get(id)?.name, id).toMatch(/^@deepseek-ai\//)
    for (const id of ['sci-tier', 'sci-plan', 'sci-deliver', 'sci-tier-suggest']) {
      expect(rows.has(id), `${id} belongs to a preset, not the host layer`).toBe(false)
    }
  })

  it('serves built-in skills from the vault at the host layer', () => {
    // The host `skill-filesystem` row stays disabled (the web layer hands local
    // discovery to presets); user skills are mounted per preset, asserted below.
    expect(rows.get('skill-filesystem')?.disabled).toBe(true)
    expect(rows.get('sci-skills')?.name).toBe('@deepseek-ai/dsh-sci-skills')
  })

  it('gives the cold audit and recall readers a durable session index', () => {
    const config = rows.get('session-query-sqlite')?.config as { openAt?: string } | undefined
    expect(config?.openAt).toBe('first-search')
  })

  it('defaults new sessions to the balanced tier', () => {
    expect((rows.get('agent-presets')?.config as { default?: string } | undefined)?.default).toBe('sci-balanced')
  })

  it('declares this bundle\'s own preset tree as the roster\'s only configured root', () => {
    // The launcher appends ITS shipped root only for a composition that
    // declares none (`apps/cli/src/profile-boot.ts::resolvePresetRootPatch`),
    // so declaring one root is what keeps the four general-purpose `dsh`
    // presets off this profile's picker. The path is still an unevaluated
    // expression here: the launcher that loaded the layer resolves it.
    const config = rows.get('agent-presets')?.config as {
      roots?: readonly { path?: unknown; trust?: string }[]
      includeUserRoot?: boolean
    } | undefined

    expect(config?.roots).toHaveLength(1)
    expect(config?.roots?.[0]?.path)
      .toEqual({ __jsExpr: "dshBundlePath('@deepseek-ai/dsh-sci-profile', 'config/agent-presets')" })
    expect(config?.roots?.[0]?.trust).toBe('system')
    // Left at its default: a deployment may still author into
    // `$DSH_HOME/.agent-presets`, which the roster scans after this root.
    expect(config?.includeUserRoot).toBeUndefined()
  })

  it('leaves the agent plane the web layer disabled untouched', () => {
    for (const id of ['tool-bash', 'tool-fs', 'tool-skill', 'tool-workflow', 'tool-ralph', 'tool-str-replace-editor']) {
      expect(rows.get(id)?.disabled, id).toBe(true)
    }
  })

  it('renders the same composition dsh --profile sci --dump-config prints', async () => {
    const rootConfig = join(workdir, 'cordis.yml')
    writeFileSync(rootConfig, '[]\n')
    const dump = renderConfigDump('dsh', rootConfig, profileLayers().map(layer => ({
      label: layer.packageName,
      patches: layer.patches,
    })), () => {})

    await expect(dump.replaceAll(rootConfig, '<profile>/cordis.yml'))
      .toMatchFileSnapshot(fileURLToPath(new URL('./snapshots/profile-sci.dump.yml', import.meta.url)))
  })
})

describe('the shipped preset directories', () => {
  it('ships exactly the two presets the bundle names, each with both files', () => {
    for (const preset of SCI_PRESETS) {
      const dir = join(root, 'packages/sci/sci-profile/config/agent-presets', preset)
      expect(readFileSync(join(dir, 'preset.yml'), 'utf8')).toMatch(/^name: /m)
      expect(load(readFileSync(join(dir, 'agent.cordis.yml'), 'utf8'), { schema: entryListSchema })).toBeInstanceOf(Array)
    }
  })

  it('supplies both science presets from the declared root, with system trust, and no dsh preset', async () => {
    const presets = await discoverPresets([{ path: BUNDLED_PRESET_ROOT, trust: 'system' }])

    expect(presets.map(preset => preset.id)).toEqual([...SCI_PRESETS])
    expect(presets.map(preset => preset.name)).toEqual(['单体 / Solo', '蜂群 / Swarm'])
    for (const preset of presets) {
      expect(preset.trust, preset.id).toBe('system')
      expect(preset.broken, preset.id).toBeUndefined()
    }
    // The launcher's own four resolve nowhere in this profile.
    for (const dshPreset of ['standard', 'code', 'cordis', 'minimal']) {
      expect(presets.some(preset => preset.id === dshPreset), dshPreset).toBe(false)
    }
  })

  it('puts every group row behind an isolate realm', () => {
    for (const preset of [balancedPreset(), clusterPreset()]) {
      for (const row of preset) {
        if (row.group !== true) continue
        expect(row.isolate, `${row.id} is a group without a realm`).toBeTypeOf('object')
      }
    }
  })

  it('keeps the subagent registry and tool-subagent-report on the host plane', () => {
    const clusterIds = presetRowIds(clusterPreset())
    expect(clusterIds.has('tool-subagent-control')).toBe(true)
    for (const hostOwned of ['subagent', 'subagent-spawn-in-process', 'tool-subagent-report']) {
      expect(clusterIds.has(hostOwned), hostOwned).toBe(false)
    }
  })

  it('mounts the user-skill provider in every preset, beside the vault-backed built-ins', () => {
    // Built-ins are served host-wide by `sci-skills` (vault, by reference); a
    // user's own skills are read from the sandbox by a preset-layer
    // `skill-filesystem`, the row the web layer disables at the host.
    expect(presetRowIds(balancedPreset()).has('skill-filesystem')).toBe(true)
    expect(presetRowIds(clusterPreset()).has('skill-filesystem')).toBe(true)
  })

  it('repeats no row the composed host tree still runs', () => {
    const active = activeRows(rows)
    for (const [preset, ids] of [['sci-balanced', presetRowIds(balancedPreset())], ['sci-cluster', presetRowIds(clusterPreset())]] as const) {
      for (const id of ids) {
        expect(active.has(id), `${preset}: row "${id}" is also active in the host composition`).toBe(false)
      }
    }
  })
})

describe('05-T1 · the balanced tier cannot see a fan-out tool', () => {
  const forbidden = [
    ...(balancedPreset().find(row => row.id === 'sci-tier')?.config as { fanoutTools: string[] }).fanoutTools,
    'str_replace_editor',
  ]

  it('assembles no fan-out tool, no terminal tool, and no str_replace_editor', () => {
    const listing = toolNamesOf([...balancedPreset(), ...activeRowsList(rows)])

    expect(listing).not.toHaveLength(0)
    for (const name of forbidden) expect(listing, name).not.toContain(name)
    expect(listing.filter(toolName => toolName.startsWith('terminal_'))).toEqual([])
  })

  it('assembles the science tools the tier does allow', () => {
    const listing = toolNamesOf([...balancedPreset(), ...activeRowsList(rows)])

    expect(listing).toContain('deliver_files')
    expect(listing).toContain('suggest_tier_upgrade')
    expect(listing).toContain('bash')
    expect(listing).toContain('read')
  })

  it('does assemble the fan-out tools at the cluster tier', () => {
    const listing = toolNamesOf([...clusterPreset(), ...activeRowsList(rows)])

    expect(listing).toContain('workflow')
    expect(listing).toContain('declare_research_plan')
    // One delegation tool per persona replaces the single unbound `subagent`:
    // the charter is bound to the mounted row, so the name the model calls is
    // the persona it gets.
    for (const name of PERSONA_NAMES) expect(listing, name).toContain(subagentToolName(name))
    expect(listing).not.toContain('subagent')
    expect(listing).not.toContain('suggest_tier_upgrade')
    expect(listing).not.toContain('ralph')
  })
})

/** The composed host rows that are still active, as a row list. */
function activeRowsList(index: ReadonlyMap<string, EntryOptions>): EntryOptions[] {
  return [...index.values()].filter(row => row.disabled !== true)
}
