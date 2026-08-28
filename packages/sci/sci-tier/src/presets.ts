/**
 * The agent presets that carry the two tiers.
 *
 * The names are the preset directory names of
 * `ClawsGO-System/09-Target-Architecture/05-tier-model.md` §preset 真实形状, which
 * `@deepseek-ai/dsh-sci-profile` ships under `config/agent-presets/`. They are
 * the fallback, not the authority: a session composed per preset carries the
 * name it was actually composed from in `SessionHeader.agentPreset`, and that
 * value wins wherever it is present. The constant covers the composition that
 * mounts this plugin without a preset at all — a single-preset deployment or a
 * test harness — where the tier is still a real fact about the session.
 * @module @deepseek-ai/dsh-sci-tier/presets
 */

import type { SciTier } from './types.ts'

/** Preset each tier is composed from, by tier. */
export const PRESET_NAMES: Readonly<Record<SciTier, string>> = {
  balanced: 'sci-balanced',
  cluster: 'sci-cluster',
}
