/**
 * Wire tool name -> the noun a researcher reads. The names are the harness's
 * own tool identities, not translatable copy: every sci surface that titles a
 * call (this package's details body and the sci conversation's cards) must
 * read one call the same way, so the table lives here and travels through
 * `./client` rather than being restated per package.
 *
 * A name with no entry displays verbatim — an unmapped tool still titles its
 * card with something the user can search for, instead of a placeholder.
 */

/** Tools whose Chinese noun is fixed by this table. */
const TOOL_NAMES: Readonly<Record<string, string>> = {
  web_search: '网页搜索',
  literature_search: '文献检索',
  web_fetch: '网页浏览',
  bash: '命令执行',
  read: '读取文件',
  write: '写入文件',
  edit: '修改文件',
  subagent: '子智能体',
  workflow: '多智能体流程',
  skill: '技能',
  deliver_files: '交付文件',
  declare_research_plan: '研究计划',
  todo: '任务清单',
  ask_user: '询问用户',
}

/** Prefix of the office runtime's tool family, which shares one noun. */
const OFFICE_PREFIX = 'univer_'

/**
 * The display noun for one wire tool name.
 * @param name - the wire tool name.
 * @returns the Chinese noun, or the raw name when this table has none.
 */
export function toolDisplayName(name: string): string {
  const known = TOOL_NAMES[name]
  if (known !== undefined) return known
  return name.startsWith(OFFICE_PREFIX) ? '文档操作' : name
}
