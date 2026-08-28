/**
 * The science-research profile layer: the `dsh-sci` bundle patch, the two
 * shipped agent presets, and the six subagent persona charters.
 *
 * Most of this package is composition rather than code — `cordis.patch.yml` is
 * the patch layer `dsh --profile sci` stacks over `dsh-base` and `dsh-web-app`,
 * and `config/agent-presets/` holds the two per-session compositions. The one
 * plugin here is the persona roster: this harness has no file-discovered agent
 * definitions, and `@deepseek-ai/dsh-tool-subagent` binds one persona per
 * MOUNTED row rather than per call, so the roster reaches the model as a
 * system-prompt section that the orchestrating thread copies into each child
 * prompt. The section is mounted by `sci-cluster` only: the balanced tier
 * cannot fan out, so a roster there would describe agents it may not start.
 * @module @deepseek-ai/dsh-sci-profile
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { PERSONA_NAMES } from '@deepseek-ai/dsh-sci-plan'
// Type-only: merges the service this plugin injects onto Context.
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  PERSONAS_SECTION_ORDER,
  SECTION_PERSONAS,
  assertCompleteRoster,
  parsePersonaDocument,
  renderPersonaRoster,
} from './persona-file.ts'
import type { SciPersona } from './types.ts'

export {
  PERSONAS_SECTION_ORDER,
  SECTION_PERSONAS,
  assertCompleteRoster,
  parsePersonaDocument,
  renderPersonaRoster,
} from './persona-file.ts'
export type { SciPersona } from './types.ts'

/** Extension of a persona charter document. */
const CHARTER_EXTENSION = '.md'

/**
 * Absolute path of the persona charters shipped inside this package.
 *
 * Resolved from the module rather than configured, because the tree ships as a
 * package resource: `lib/index.js` and `src/index.ts` both sit one level under
 * the package root, so the same expression holds in the source and built layouts.
 */
export const BUNDLED_AGENTS_ROOT: string = fileURLToPath(new URL('../config/agents', import.meta.url))

/**
 * Absolute path of the two shipped agent presets.
 *
 * The directory `cordis.patch.yml` declares as the roster's only configured
 * root, through the launcher's `dshBundlePath`: only a resolver that can find
 * this package knows the absolute path. Exported for a test holding no launcher.
 */
export const BUNDLED_PRESET_ROOT: string = fileURLToPath(new URL('../config/agent-presets', import.meta.url))

/** Directory names of the two presets this bundle ships, in roster order. */
export const SCI_PRESETS: readonly string[] = ['sci-balanced', 'sci-cluster']

/** Deployment-varying choices for the persona roster. */
export interface Config {
  /**
   * Absolute path of the directory holding one `<persona>.md` charter per
   * persona. Defaults to the tree shipped inside this package; a deployment
   * overrides it to publish rewritten charters without forking the bundle.
   */
  agentsRoot: string
}

/** Schemastery schema for the persona roster. */
export const Config: z<Config> = z.object({
  agentsRoot: z.string().default(BUNDLED_AGENTS_ROOT),
})

/** Cordis plugin name. */
export const name = 'sci-profile'

/** The prompt layer the roster section joins. */
export const inject = ['systemPrompt']

/**
 * Read every persona charter under one directory, in `PERSONA_NAMES` order.
 *
 * Listing order is the declared persona order rather than the directory's,
 * so the assembled section is byte-identical across filesystems — the section
 * sits in the request prefix, and a roster that reordered itself per machine
 * would invalidate the cache for no reason.
 * @param agentsRoot - absolute path of the charter directory.
 * @returns the complete roster in listing order.
 * @throws Error when the directory cannot be read, when a document is
 *   malformed, or when the roster is not exactly the six declared personas.
 */
export function loadPersonas(agentsRoot: string): SciPersona[] {
  let entries: string[]
  try {
    entries = readdirSync(agentsRoot)
  } catch (error) {
    throw new Error(`sci-profile: cannot read the persona directory ${agentsRoot}: ${String(error)}`)
  }
  const parsed = entries
    .filter(entry => entry.endsWith(CHARTER_EXTENSION))
    .map((entry) => {
      const path = join(agentsRoot, entry)
      return parsePersonaDocument(readFileSync(path, 'utf8'), path)
    })
  assertCompleteRoster(parsed)
  const byName = new Map(parsed.map(persona => [persona.name, persona]))
  // `assertCompleteRoster` proved every declared name is present.
  return PERSONA_NAMES.map(personaName => byName.get(personaName) as SciPersona)
}

/**
 * Register the persona roster section on the mounting context.
 * @param ctx - the mounting context, carrying `systemPrompt`.
 * @param config - the resolved deployment configuration.
 * @throws Error when the charter directory is unreadable or its documents do
 *   not form the complete roster.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.systemPrompt.section({
    name: SECTION_PERSONAS,
    order: PERSONAS_SECTION_ORDER,
    text: renderPersonaRoster(loadPersonas(config.agentsRoot)),
  })
}
