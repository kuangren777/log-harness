/**
 * Validators for the two bundle manifests that open a workbench on the user's
 * side: `.paper` (LaTeX manuscript) and `.sciplot` (code-rendered figure).
 *
 * Both schemas are the JSON blocks of the `clawsgo-paper` and `clawsgo-sciplot`
 * skills. Platform-owned collections (`versions`, `history`, `output`,
 * `annotations`) are checked for their container type only: the workbench and
 * the render script write their rows, so constraining row members here would
 * reject a manifest this agent never produced. Ownership of those fields is
 * enforced separately by `diffOwnedFields`.
 * @module @deepseek-ai/dsh-sci-manifest/bundles
 */

import {
  requireArray,
  requireEntry,
  requireObject,
  requireString,
  requireUtcTimestamp,
  requireVersion,
} from './fields.ts'
import { toResult } from './kinds.ts'
import type { ValidationResult } from './kinds.ts'

const PAPER = 'paper manifest'
const SCIPLOT = 'sciplot manifest'

/** The root `.tex` file the LaTeX workbench compiles. */
const PAPER_ENTRY_EXTENSIONS = ['.tex'] as const
/** The languages `render.py` can execute as a sciplot entry script. */
const SCIPLOT_ENTRY_EXTENSIONS = ['.py', '.r', '.sh', '.jl'] as const

/**
 * Validate a `.paper` bundle manifest.
 * @param json - the parsed manifest, or any value read from the manifest path.
 * @returns success, or every offending field named in manifest order.
 */
export function validatePaper(json: unknown): ValidationResult {
  const errors: string[] = []
  const manifest = requireObject(json, PAPER, errors)
  if (manifest !== undefined) {
    requireVersion(manifest, PAPER, errors)
    requireString(manifest, 'title', `${PAPER}.title`, errors)
    requireEntry(manifest, `${PAPER}.entry`, PAPER_ENTRY_EXTENSIONS, errors)
    requireArray(manifest, 'versions', `${PAPER}.versions`, errors)
    requireUtcTimestamp(manifest, 'createdAt', `${PAPER}.createdAt`, errors)
    requireUtcTimestamp(manifest, 'updatedAt', `${PAPER}.updatedAt`, errors)
  }
  return toResult('paper', errors)
}

/**
 * Validate a `.sciplot` bundle manifest. `output` carries no check: the render
 * script owns it and the skill's JSON block does not fix its type.
 * @param json - the parsed manifest, or any value read from the manifest path.
 * @returns success, or every offending field named in manifest order.
 */
export function validateSciplot(json: unknown): ValidationResult {
  const errors: string[] = []
  const manifest = requireObject(json, SCIPLOT, errors)
  if (manifest !== undefined) {
    requireVersion(manifest, SCIPLOT, errors)
    requireString(manifest, 'title', `${SCIPLOT}.title`, errors)
    requireString(manifest, 'language', `${SCIPLOT}.language`, errors)
    requireString(manifest, 'style', `${SCIPLOT}.style`, errors)
    requireEntry(manifest, `${SCIPLOT}.entry`, SCIPLOT_ENTRY_EXTENSIONS, errors)
    requireArray(manifest, 'history', `${SCIPLOT}.history`, errors)
    requireArray(manifest, 'annotations', `${SCIPLOT}.annotations`, errors)
  }
  return toResult('sciplot', errors)
}
