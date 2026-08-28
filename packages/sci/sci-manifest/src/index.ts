/**
 * Validators and the owned-field diff for the three ClawsGO bundle manifests:
 * `.paper` (LaTeX manuscript), `.sciplot` (code-rendered figure), `.canvas`
 * (node board).
 *
 * The package is a pure library — no Cordis service, no plugin, no filesystem
 * access. Everything a manifest cannot answer for itself arrives as an injected
 * predicate, so the same functions run inside a `tools/pre-execute` gate, inside
 * the delivery validation chain, and inside the in-sandbox `sci` CLI. Every
 * message names the offending field path, node id, or edge id, so a denial
 * reason can quote it verbatim.
 *
 * Validation is deliberately not exhaustive over platform-written rows.
 * `versions`, `history`, `output`, and `annotations` are written by the
 * workbench, the render script, and the user; their container type is checked
 * and their rows are not, because a stricter row schema would reject manifests
 * this agent never produced. That the agent must not write them at all is
 * enforced by {@link diffOwnedFields}, not by the validators.
 * @module @deepseek-ai/dsh-sci-manifest
 */

export { validatePaper, validateSciplot } from './bundles.ts'
export { validateCanvas } from './canvas.ts'
export type { CanvasAssetResolver } from './canvas.ts'
export { diffOwnedFields } from './owned-fields.ts'
export { BUNDLE_KINDS, isManifestPath } from './kinds.ts'
export type { ManifestKind, ValidationResult } from './kinds.ts'
