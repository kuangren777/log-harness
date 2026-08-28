/**
 * Every model-facing tool name this package can register.
 *
 * The list is the referent `disabledTools` is validated against, so a
 * deployment that misspells a name fails at load instead of silently keeping a
 * tool it meant to remove. Adding a tool means adding its name here.
 */
export const UNIVER_TOOL_NAMES = [
  'univer_new',
  'univer_status',
  'univer_worktree',
  'univer_unit',
  'univer_import',
  'univer_inspect',
  'univer_execute',
  'univer_export',
  'univer_lint',
  'univer_compile_svg',
  'univer_screenshot',
  'univer_api',
  'univer_resources',
] as const

/** One registrable Univer tool name. */
export type UniverToolName = (typeof UNIVER_TOOL_NAMES)[number]
