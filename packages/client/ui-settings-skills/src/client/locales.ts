/** Copy dictionaries for the Skills settings section. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'Skills',
  title: 'Skills',
  intro: 'Every skill this project discovers, and who may invoke it.',
  scope: 'Discovered for {cwd}',
  noSession: 'Open a session first. Skills are discovered from the session’s working directory, so there is nothing to list yet.',
  empty: 'This project discovers no skills.',
  loading: 'Reading the skill inventory…',
  loadFailed: 'Reading the skill inventory failed',
  retry: 'Retry',
  incomplete: 'A provider did not answer, so this list is partial.',
  readOnly: 'The settings document is read-only in this deployment.',
  model: 'Model',
  user: 'User',
  modelToggle: 'Model may invoke {name}',
  userToggle: 'User may invoke {name}',
  overridden: 'Overridden',
  reset: 'Reset',
  resetSkill: 'Reset {name} to its authored policy',
  shadowed: 'shadowed by a nearer definition',
  sourceProjectDsh: 'Project (.dsh/skills)',
  sourceProjectAgents: 'Project (.agents/skills)',
  sourceProjectClaude: 'Project (.claude/skills)',
  sourceUserDsh: 'User (.dsh/skills)',
  sourceUserAgents: 'User (.agents/skills)',
  sourceUserClaude: 'User (.claude/skills)',
  sourceCustom: 'Configured directory',
  sourceBundled: 'Bundled with this deployment',
  sourceRuntime: 'Contributed at runtime',
}

/** Chinese strings (same key set as {@link en}). */
export const zh: Record<keyof typeof en, string> = {
  nav: '技能',
  title: '技能',
  intro: '本项目能发现的全部技能，以及谁可以调用它们。',
  scope: '发现范围：{cwd}',
  noSession: '请先打开一个会话。技能按会话的工作目录发现，现在还没有可列出的内容。',
  empty: '本项目没有发现任何技能。',
  loading: '正在读取技能清单…',
  loadFailed: '读取技能清单失败',
  retry: '重试',
  incomplete: '有提供方未应答，这份列表并不完整。',
  readOnly: '本部署的设置文档为只读。',
  model: '模型',
  user: '用户',
  modelToggle: '允许模型调用 {name}',
  userToggle: '允许用户调用 {name}',
  overridden: '已覆盖',
  reset: '恢复默认',
  resetSkill: '将 {name} 恢复为技能自身声明的策略',
  shadowed: '被更近的定义覆盖',
  sourceProjectDsh: '项目（.dsh/skills）',
  sourceProjectAgents: '项目（.agents/skills）',
  sourceProjectClaude: '项目（.claude/skills）',
  sourceUserDsh: '用户（.dsh/skills）',
  sourceUserAgents: '用户（.agents/skills）',
  sourceUserClaude: '用户（.claude/skills）',
  sourceCustom: '配置的目录',
  sourceBundled: '随本部署分发',
  sourceRuntime: '运行时贡献',
}

/** Copy keys this plugin's namespace owns. */
export type SkillsKey = keyof typeof en

/** Bound translate for this namespace. */
export type SkillsTranslate = (key: SkillsKey, params?: Record<string, unknown>) => string

/**
 * Copy key per host origin bucket. The host vocabulary is open, so a value
 * absent here renders raw rather than as a wrong label.
 */
const SOURCE_KEYS: Readonly<Record<string, SkillsKey>> = {
  'project-dsh': 'sourceProjectDsh',
  'project-agents': 'sourceProjectAgents',
  'project-claude': 'sourceProjectClaude',
  'user-dsh': 'sourceUserDsh',
  'user-agents': 'sourceUserAgents',
  'user-claude': 'sourceUserClaude',
  custom: 'sourceCustom',
  bundled: 'sourceBundled',
  runtime: 'sourceRuntime',
}

/**
 * Localized title for one inventory group's origin.
 * @param source - the host's origin bucket, from an open vocabulary.
 * @param t - this namespace's bound translate.
 * @returns the localized label, or the raw source when it is unrecognized.
 */
export function sourceLabel(source: string, t: SkillsTranslate): string {
  const key = SOURCE_KEYS[source]
  return key === undefined ? source : t(key)
}
