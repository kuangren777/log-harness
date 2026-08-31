/**
 * The tier section of the science-research system prompt — one of three texts,
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

import type { SciTierMode } from './types.ts'

/** Registry key of the balanced tier's section. */
export const SECTION_TIER_BALANCED = 'sci:tier:balanced'

/** Registry key of the cluster tier's section. */
export const SECTION_TIER_CLUSTER = 'sci:tier:cluster'

/** Registry key of the auto composition's section. */
export const SECTION_TIER_AUTO = 'sci:tier:auto'

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
  + 'due-diligence-grade coverage, a real experiment or reproduction), you have '
  + 'exactly two exits. Either deliver a genuinely smaller result — a real '
  + 'pilot at reduced scale, every number produced by code that actually ran '
  + 'in this session, its reduced scope stated in the deliverable — or finish '
  + 'what a single pass can honestly deliver and call `suggest_tier_upgrade` '
  + 'with one sentence on what the swarm would add; the user decides. There '
  + 'is no third exit: a large-looking result whose numbers were not produced '
  + 'by real execution, whose pipeline never called the system it claims to '
  + 'test, or whose conclusion no run supports, is worse than the honest '
  + 'smaller one and is never delivered.'

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
  + 'progress. Every plan carries an adversary (`security` icon) whose task is '
  + 'to break what the others produce — a plan of producers alone is refused — '
  + 'and when a step leaves code, results, or files behind, the adversary runs '
  + 'after it and checks the artifact and the log that produced it, never the '
  + 'producer\'s own summary. Cross-check from several angles — corroborate each fact from '
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

/**
 * The auto composition's section text. It carries the swarm disciplines the
 * cluster text states, condensed, because a session resolved to `cluster`
 * mid-way reads no other section: the prompt is assembled once per session and
 * the cluster text opens with a choice this user did not make.
 */
export const CHAPTER_TIER_AUTO =
  'Auto mode (自动) is on for this session — the user left the choice between '
  + 'a single-threaded pass and a swarm to the task itself, and reserved the '
  + 'swarm\'s spend for tasks that need it. Before any other tool call, judge '
  + 'the task and call `resolve_tier`: choose `cluster` when the work needs a '
  + 'real experiment or reproduction, systematic multi-source research, or '
  + 'due-diligence-grade coverage that one thread cannot honestly finish; '
  + 'choose `balanced` for everything one careful pass covers. Until you '
  + 'resolve, no fan-out tool runs. A `balanced` resolution is raised '
  + 'mid-session by calling `resolve_tier` again with `cluster` and the reason, '
  + 'the moment the work turns out larger than one pass — so there is never a '
  + 'reason to stand in a large-looking result whose numbers no real run '
  + 'produced: a smaller real result with its scope stated, or a raised tier, '
  + 'are the only exits. Resolved to `cluster`, work as a swarm: decompose the '
  + 'question into independent slices before you delegate; declare with '
  + '`declare_research_plan` immediately before every fan-out, one declaration '
  + 'per fan-out; every plan carries an adversary (`security` icon) that runs '
  + 'after any step leaving code, results, or files behind and checks the '
  + 'artifact and the log that produced it, never the producer\'s own summary; '
  + 'corroborate each fact from independent sources and cite in place, inside '
  + 'the deliverable files as well; and synthesize into one weighed deliverable '
  + 'rather than a pile of fragments.'

/** The section each tier mode registers: its registry key and its text. */
export const TIER_SECTIONS: Readonly<Record<SciTierMode, { readonly name: string; readonly text: string }>> = {
  balanced: { name: SECTION_TIER_BALANCED, text: CHAPTER_TIER_BALANCED },
  cluster: { name: SECTION_TIER_CLUSTER, text: CHAPTER_TIER_CLUSTER },
  auto: { name: SECTION_TIER_AUTO, text: CHAPTER_TIER_AUTO },
}
