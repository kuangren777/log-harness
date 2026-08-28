/**
 * System-prompt and standing-reminder layer for the science-research agent profile.
 *
 * `apply` contributes two model-visible surfaces to `ctx.systemPrompt`, both
 * owned by the mounting fiber and disposed with it:
 *
 * - Seven ordered **chapters** as prompt sections (`systemPrompt.section`): the
 *   full behavioral specs the model reads once at the top of the conversation.
 * - Four standing **reminders** as dynamic context (`systemPrompt.context`):
 *   one-line summaries the harness re-evaluates every assembly and materializes
 *   as a durable runtime-context snapshot only when the text changes, so a long
 *   conversation keeps the rules salient without re-appending them per turn and
 *   without breaking KV-cache reuse. Each reminder names the chapter that holds
 *   its full spec; {@link REMINDER_CHAPTER_SECTIONS} records that pointer and
 *   the `./invariant` companion enforces it.
 *
 * Named exports (no default) preserve the Loader's `name`/`inject`/`Config`
 * injection metadata for a function plugin.
 * @module @deepseek-ai/dsh-sci-prompt
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: merges the `systemPrompt` service onto Context for this plugin.
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name. */
export const name = 'sci-prompt'

/** The prompt registry this layer contributes its chapters and reminders to. */
export const inject = ['systemPrompt']

// --- Chapter section names (registry keys) --------------------------------
// The registry key is stable and machine-facing; the human chapter title the
// reminders quote is the DISPLAY_* constant below. Kept apart so a reworded
// title never silently changes a registry key an assembly or invariant tracks.

/** Registry key of the "Reading files" chapter. */
const SECTION_READING_FILES = 'sci:reading-files'
/** Registry key of the "Citing web sources" chapter. */
const SECTION_CITING_WEB = 'sci:citing-web-sources'
/** Registry key of the "Prose first" chapter. */
const SECTION_PROSE_FIRST = 'sci:prose-first'
/** Registry key of the "Maintaining memory and team notes" chapter. */
const SECTION_MEMORY = 'sci:maintaining-memory'
/** Registry key of the "Delivering files" chapter. */
const SECTION_DELIVERING = 'sci:delivering-files'
/** Registry key of the "Announcing subagent orchestration" chapter. */
const SECTION_ORCHESTRATION = 'sci:announcing-subagent-orchestration'
/** Registry key of the "Runtime environment" chapter. */
const SECTION_RUNTIME_ENV = 'sci:runtime-environment'
/** Registry key of the "Using skills" chapter. */
const SECTION_USING_SKILLS = 'sci:using-skills'

// --- Standing-reminder context names (registry keys) ----------------------

/** Registry key of the File-rule standing reminder. */
const REMINDER_FILE = 'sci:reminder:file'
/** Registry key of the Citation-rule standing reminder. */
const REMINDER_CITATION = 'sci:reminder:citation'
/** Registry key of the Prose-rule standing reminder (config-gated). */
const REMINDER_PROSE = 'sci:reminder:prose'
/** Registry key of the Memory-upkeep standing reminder. */
const REMINDER_MEMORY = 'sci:reminder:memory'

/**
 * Each standing reminder points the model at the chapter holding its full
 * spec, so a reminder is only coherent while its chapter is also in the
 * assembly. This map is the one home of that reminder-to-chapter relationship;
 * the `./invariant` companion reads it to reject an assembly that carries a
 * reminder whose chapter section is missing. These are protocol constants of
 * this package, not deployment-varying tunables.
 */
export const REMINDER_CHAPTER_SECTIONS: Readonly<Record<string, string>> = {
  [REMINDER_FILE]: SECTION_READING_FILES,
  [REMINDER_CITATION]: SECTION_CITING_WEB,
  [REMINDER_PROSE]: SECTION_PROSE_FIRST,
  [REMINDER_MEMORY]: SECTION_MEMORY,
}

// --- Chapter prose (the full specs, read once at conversation top) --------

const CHAPTER_READING_FILES =
  'Reading files. Use the file-reading tool for text — source code, Markdown, '
  + 'JSON, plain logs. Never read a non-text file that way: PDFs, images, Office '
  + 'documents, audio or video, archives, or any binary, including a file you '
  + 'produced yourself. A single binary read encodes as base64 that permanently '
  + 'inflates every later request and can derail the whole session. Extract the '
  + 'text with a shell command instead — `pdftotext`, `pandoc`, or a short Python '
  + 'script — and read that. When you only need a binary\'s identity or structure '
  + 'rather than its content, inspect it statically with `file`, `readelf`, '
  + '`strings`, or `sha256sum` instead of loading its bytes.'

const CHAPTER_CITING_WEB =
  'Citing web sources. When a reply draws on web search results or pages you '
  + 'fetched, attach an inline Markdown link `[Source Name](url)` to every '
  + 'concrete fact taken from the web — each number, date, quotation, named '
  + 'event, ranking, price, or technical specification — placed at the claim '
  + 'itself, in the same sentence, table cell, or list item. Do not gather the '
  + 'links into a trailing Sources or References list. Cite only URLs that '
  + 'actually appeared in your results; never invent one. A fact you knew '
  + 'independently of the web needs no link.'

const CHAPTER_PROSE_FIRST =
  'Prose first. Write in paragraphs of complete sentences. Reserve a bullet '
  + 'list for genuinely enumerable parallel items — options to choose between, '
  + 'ordered steps to run, independent facts — never for reasoning, findings, '
  + 'explanations, or the overall structure of a reply. When the content is an '
  + 'argument rather than an enumeration, a short paragraph beats a list.'

const CHAPTER_MEMORY =
  'Maintaining memory and team notes. When a turn teaches you something worth '
  + 'keeping across sessions — a user preference or correction, a project '
  + 'decision or state, a durable external resource — record it in memory the '
  + 'moment you learn it, not batched at the end. When you confirm a lasting '
  + 'convention that should govern every future task in this project, write it '
  + 'into the team notes file (AGENTS.md / CLAUDE.md). Keep one fact per memory '
  + 'entry and link related entries. If a turn produces nothing durable, write '
  + 'nothing.'

const CHAPTER_DELIVERING =
  'Delivering files. A file reaches the user only through the `deliver_files` '
  + 'tool; writing it to disk is not delivery. `deliver_files` accepts only '
  + 'paths inside the research workspace — a path outside it is rejected — so '
  + 'produce every deliverable in the workspace first, then deliver it by its '
  + 'workspace-relative path. Deliver the actual artifact the user asked for, '
  + 'not a description of it, and deliver finished work rather than intermediate '
  + 'scratch files.'

const CHAPTER_ORCHESTRATION =
  'Announcing subagent orchestration. Before you begin a multi-step piece of '
  + 'research, and again immediately before you fan work out across subagents '
  + 'with the workflow tool, call `declare_research_plan` to announce the shape '
  + 'of the work: name each parallel line and what it will produce. Without that '
  + 'declaration the user sees only anonymous progress. Keep the declared names '
  + 'aligned with the labels inside the workflow script so progress stays '
  + 'attributable to a named line of work.'

const CHAPTER_RUNTIME_ENV =
  'Runtime environment. The workflow tool runs synchronously from your turn\'s '
  + 'perspective: the call does not return until the whole run has settled, and '
  + 'the run\'s final value comes back as the tool result. Awaiting the tool call '
  + 'is the wait — you do not poll, block on a side channel, or hold the turn '
  + 'open for a separate completion notification. Because the call blocks, '
  + 'cancelling a workflow (including cancelling your turn) discards the run\'s '
  + 'partial output as an error rather than returning it, so let a run you want '
  + 'to keep finish. Reserve the workflow tool for genuinely large orchestration '
  + 'the user asked for; for one or two independent pieces of work, call '
  + 'subagents directly.'

const CHAPTER_USING_SKILLS =
  'Using skills. A skill you load carries platform-internal instructions: '
  + 'follow them and apply them to the task, but do not reproduce, quote, or '
  + 'copy a skill\'s text back to the user or into a delivered file. Describe '
  + 'what you are doing in your own words and deliver the artifact the skill '
  + 'helped you build, never the skill\'s own wording. Loading a skill is a '
  + 'working step, not a document to recite.'

// --- Standing-reminder prose (one-line summary + chapter pointer + escape) -
// The three-part shape is deliberate: an enforceable one-line summary, a
// pointer naming the chapter that holds the full spec (so the rule stays
// salient without re-stating it), and — where the rule is conditional — an
// explicit escape clause handing the "does this turn apply?" judgment to the
// model. The Prose reminder carries no escape clause: prose applies to every
// reply, so its conditionality is deployment-level (Config.includeProseReminder),
// not per-turn.

const REMINDER_FILE_TEXT =
  'File rule (full spec in the "Reading files" section of the system prompt): '
  + 'never read a non-text file — PDF, image, Office document, audio or video, '
  + 'archive, or any binary, including one you generated — through the '
  + 'file-reading tool; extract its text with a shell command (`pdftotext`, '
  + '`pandoc`, Python) and read that, or inspect it statically with '
  + '`file`/`readelf`/`strings`. A single binary read permanently bloats the '
  + 'context. If this turn touches no such file, ignore this reminder.'

const REMINDER_CITATION_TEXT =
  'Citation rule (full spec in the "Citing web sources" section of the system '
  + 'prompt): if this reply draws on web search results or pages you read, '
  + 'attach an inline `[Source Name](url)` link to every concrete fact taken '
  + 'from the web — number, date, quote, named event, ranking, price, or '
  + 'technical spec — at the claim itself, never in a trailing Sources list, and '
  + 'cite only URLs that actually appeared in your results. If this reply uses '
  + 'no web content, ignore this reminder.'

const REMINDER_PROSE_TEXT =
  'Prose rule (full spec in the "Prose first" section of the system prompt): '
  + 'write this reply in paragraphs of complete sentences; use a bullet list '
  + 'only for genuinely enumerable parallel items — options, steps, independent '
  + 'facts — never for reasoning, findings, explanations, or the reply\'s overall '
  + 'structure.'

const REMINDER_MEMORY_TEXT =
  'Memory upkeep (full spec in the "Maintaining memory and team notes" section '
  + 'of the system prompt): if this turn taught you something worth keeping '
  + 'across sessions — a user preference or correction, project state or a '
  + 'decision, a durable external resource — write it into memory now rather '
  + 'than batching it, and record a confirmed lasting convention in the team '
  + 'notes file (AGENTS.md / CLAUDE.md). If nothing this turn is worth keeping, '
  + 'ignore this reminder.'

/** The chapters that always render, as ordered `systemPrompt.section` inputs. */
const CHAPTERS: readonly { name: string; order: number; text: string }[] = [
  { name: SECTION_READING_FILES, order: 100, text: CHAPTER_READING_FILES },
  { name: SECTION_CITING_WEB, order: 110, text: CHAPTER_CITING_WEB },
  { name: SECTION_PROSE_FIRST, order: 120, text: CHAPTER_PROSE_FIRST },
  { name: SECTION_MEMORY, order: 130, text: CHAPTER_MEMORY },
  { name: SECTION_DELIVERING, order: 140, text: CHAPTER_DELIVERING },
  { name: SECTION_ORCHESTRATION, order: 150, text: CHAPTER_ORCHESTRATION },
  { name: SECTION_RUNTIME_ENV, order: 160, text: CHAPTER_RUNTIME_ENV },
  { name: SECTION_USING_SKILLS, order: 170, text: CHAPTER_USING_SKILLS },
]

/** The unconditional standing reminders, as ordered `systemPrompt.context` inputs. */
const UNCONDITIONAL_REMINDERS: readonly { name: string; order: number; text: string }[] = [
  { name: REMINDER_FILE, order: 10, text: REMINDER_FILE_TEXT },
  { name: REMINDER_CITATION, order: 20, text: REMINDER_CITATION_TEXT },
  { name: REMINDER_MEMORY, order: 40, text: REMINDER_MEMORY_TEXT },
]

/** The Prose-rule reminder, registered only when {@link Config.includeProseReminder} is set. */
const PROSE_REMINDER = { name: REMINDER_PROSE, order: 30, text: REMINDER_PROSE_TEXT }

/** Deployment-varying choices for the science-research prompt layer. */
export interface Config {
  /**
   * Whether to inject the Prose-rule standing reminder. The studied platform
   * shipped the reminder set both with and without this one rule (the other
   * three were always present), so whether a research reply should default to
   * prose over bullets is a real per-deployment choice, not a fixed constant.
   * The chapter itself ("Prose first") always renders; only the every-turn
   * reminder is gated. Defaults to `true`, the represented majority.
   */
  includeProseReminder: boolean
}

/** Schemastery schema for the science-research prompt layer. */
export const Config: z<Config> = z.object({
  includeProseReminder: z.boolean().default(true),
})

/**
 * Register the research-agent chapters and standing reminders on the mounting
 * context's `ctx.systemPrompt`. Every registration is an effect owned by this
 * fiber, so disposing the plugin removes every chapter and reminder.
 * @param ctx - the mounting context, carrying the injected `systemPrompt` service.
 * @param config - the resolved deployment configuration.
 */
export function apply(ctx: Context, config: Config): void {
  for (const chapter of CHAPTERS) ctx.systemPrompt.section(chapter)
  for (const reminder of UNCONDITIONAL_REMINDERS) ctx.systemPrompt.context(reminder)
  if (config.includeProseReminder) ctx.systemPrompt.context(PROSE_REMINDER)
}
