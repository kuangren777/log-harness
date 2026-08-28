/**
 * The tier section of the science-research system prompt — one of two texts,
 * selected by the mounted {@link Config.tier}.
 *
 * The studied platform delivered both of these as a per-turn `<system-reminder>`
 * injection (`ClawsGO-System/04-System-Prompts/verbatim/reminder-B-balanced-mode.txt`
 * and `reminder-C-cluster-mode-2026-08-24.txt`), which re-materialised 762 B or
 * 3.5 KB into every request and enforced nothing. Here the text is a prompt
 * SECTION: it is assembled once per session, sits in the stable prefix, and the
 * rule it states is separately enforced — by the fan-out latch for the cluster
 * tier and by `ctx.tools.guard()` for the balanced one.
 *
 * Two things changed in the words themselves. The balanced text names no
 * forbidden tool, because this tier mounts none of them and naming a tool the
 * model cannot see only teaches it that the tool exists. The cluster text drops
 * the original's third discipline whole — the "the notification never arrives"
 * runtime patch, its `TaskOutput` polling loop, and its `resumeFromRunId`
 * recovery — because none of those describe this harness; the real semantics of
 * the `workflow` and `subagent` tools live in the *Runtime environment* chapter
 * of `@deepseek-ai/dsh-sci-prompt`.
 * @module @deepseek-ai/dsh-sci-tier/chapter
 */

import type { SciTier } from './types.ts'

/** Registry key of the balanced tier's section. */
export const SECTION_TIER_BALANCED = 'sci:tier:balanced'

/** Registry key of the cluster tier's section. */
export const SECTION_TIER_CLUSTER = 'sci:tier:cluster'

/**
 * Assembly order of the tier section, one step after the *Irreversible actions*
 * chapter `@deepseek-ai/dsh-sci-guard` contributes at 165. The tier reads last
 * because it narrows what the chapters before it allow.
 */
export const TIER_SECTION_ORDER = 170

/** The balanced tier's section text. */
export const CHAPTER_TIER_BALANCED =
  'Solo mode (单体) is on for this session — the user chose the ordinary '
  + 'single-threaded pass, not the swarm tier. Subagent orchestration is '
  + 'not available here: do all the work directly in this thread. A swarm '
  + 'multiplies compute and runtime, and the user reserves that spend for '
  + 'Swarm mode, which they select explicitly. If the task genuinely exceeds '
  + 'what one thread can cover well (systematic multi-source research, '
  + 'due-diligence-grade coverage), finish what a single pass can honestly '
  + 'deliver, then call `suggest_tier_upgrade` with one sentence on what the '
  + 'swarm would add — the user decides.'

/** The cluster tier's section text. */
export const CHAPTER_TIER_CLUSTER =
  'Swarm mode (蜂群) is on for this session — the user chose '
  + 'research-grade depth: a systematic, comprehensive result that withstands '
  + 'scrutiny (industry research, due diligence, literature review, '
  + 'multi-option evaluation, complex selection). A task like that exceeds what '
  + 'a single thread covers in one sweep, so decompose it, drive it with a '
  + 'swarm of parallel subagents, and synthesize what they return. Decompose '
  + 'before you delegate: cut the question into independent, parallelizable '
  + 'subtopics with clear boundaries and minimal overlap. Orchestrate the '
  + 'swarm with the `workflow` tool — each subagent owns one slice\'s search '
  + 'and close reading, so do not walk one thread down a single line to the '
  + 'end, and launch another round when the last one left gaps. Declare with '
  + '`declare_research_plan` immediately before every fan-out: one declaration '
  + 'authorizes one fan-out, and without it the user sees only anonymous '
  + 'progress. Cross-check from several angles — corroborate each fact from '
  + 'independent sources, and turn "what angle is still uncovered, what claim '
  + 'still unverified, what primary source still unread" into the next batch of '
  + 'subagent tasks. Source rigorously and cite in place: every number, date, '
  + 'quote, named event, ranking, price, or technical spec carries an inline '
  + 'source link at the claim, inside the deliverable files as well, and when '
  + 'sources disagree lay out the disagreement and the range instead of '
  + 'silently picking one. Synthesize into one structured deliverable — '
  + 'skeleton first, then fill it in, and finish with a weighed conclusion '
  + 'rather than a pile of fragments. Research-grade depth means longer runtime '
  + 'and higher spend, which the user chose deliberately, so never trade '
  + 'coverage or rigor for speed.'

/** The section each tier registers: its registry key and its text. */
export const TIER_SECTIONS: Readonly<Record<SciTier, { readonly name: string; readonly text: string }>> = {
  balanced: { name: SECTION_TIER_BALANCED, text: CHAPTER_TIER_BALANCED },
  cluster: { name: SECTION_TIER_CLUSTER, text: CHAPTER_TIER_CLUSTER },
}
