/**
 * The card's leading glyph per wire tool name.
 *
 * The Chinese noun beside it is NOT restated here: `toolDisplayName` lives in
 * ui-sci-files and travels through its `/client`, so the details panel and
 * this card read one call the same way by construction. This module adds the
 * one thing a card needs and a panel does not — an icon — and nothing else.
 */
import type { ReactNode } from 'react'
import {
  IconAgentPresetOutline16, IconApiOutline14, IconArchiveOutline20, IconBrowseOutline16,
  IconChecklistOutline14, IconDataOutline16, IconEditOutline16, IconGlobeOutline14, IconGoalOutline16,
  IconQuestionOutline14, IconSearchOutline16, IconSkillOutline16, IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Glyph edge length inside the card's 28px leading tile, in CSS pixels. */
const GLYPH_SIZE = 14

/** Wire tool name -> its leading glyph; an unmapped tool takes the generic sparkle. */
const TOOL_ICONS: Readonly<Record<string, ReactNode>> = {
  web_search: <IconSearchOutline16 size={GLYPH_SIZE} />,
  web_fetch: <IconGlobeOutline14 size={GLYPH_SIZE} />,
  bash: <IconApiOutline14 size={GLYPH_SIZE} />,
  read: <IconBrowseOutline16 size={GLYPH_SIZE} />,
  write: <IconEditOutline16 size={GLYPH_SIZE} />,
  edit: <IconEditOutline16 size={GLYPH_SIZE} />,
  subagent: <IconAgentPresetOutline16 size={GLYPH_SIZE} />,
  workflow: <IconAgentPresetOutline16 size={GLYPH_SIZE} />,
  skill: <IconSkillOutline16 size={GLYPH_SIZE} />,
  deliver_files: <IconArchiveOutline20 size={GLYPH_SIZE} />,
  declare_research_plan: <IconGoalOutline16 size={GLYPH_SIZE} />,
  todo: <IconChecklistOutline14 size={GLYPH_SIZE} />,
  ask_user: <IconQuestionOutline14 size={GLYPH_SIZE} />,
}

/** Prefix of the office runtime's tool family, which shares one glyph. */
const OFFICE_PREFIX = 'univer_'

/**
 * Prefix of the persona-bound delegation tools (`subagent_researcher` and its
 * five siblings), which the sci-cluster preset mounts in place of the single
 * generic `subagent`.
 */
const SUBAGENT_PREFIX = 'subagent_'

/** The tools whose card body is the galaxy board rather than a tool view. */
const AGENT_TOOLS: ReadonlySet<string> = new Set(['subagent', 'workflow'])

/**
 * The leading glyph for one wire tool name.
 * @param name - the wire tool name.
 * @returns the icon element.
 */
export function toolIcon(name: string): ReactNode {
  const known = TOOL_ICONS[name]
  if (known !== undefined) return known
  if (name.startsWith(SUBAGENT_PREFIX)) return <IconAgentPresetOutline16 size={GLYPH_SIZE} />
  return name.startsWith(OFFICE_PREFIX)
    ? <IconDataOutline16 size={GLYPH_SIZE} />
    : <IconSparkle16 size={GLYPH_SIZE} />
}

/**
 * Whether this tool delegates work to agents, and so shows the galaxy board.
 * @param name - the wire tool name.
 * @returns whether the card body is the galaxy.
 */
export function isAgentTool(name: string): boolean {
  return AGENT_TOOLS.has(name) || name.startsWith(SUBAGENT_PREFIX)
}
