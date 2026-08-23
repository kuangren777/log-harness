/**
 * Copy dictionaries for the Access administration section.
 *
 * The warning strings carry the weight of this package: a domain's first rule
 * turns the whole domain into an allowlist, and the copy has to say what that
 * costs a member before the administrator saves it.
 */

import type { AccessDomain } from './rules.ts'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  nav: '访问控制',
  title: '访问控制',
  intro: '账号、权限组、成员关系，以及每个组的权限规则。',
  adminOnly: '只有管理员可以管理账号与权限组。隐藏这一页只是省去无用的表单：真正拦住请求的是 Host，它会拒绝非管理员发出的每一次管理调用。',
  notAuthenticating: '本部署没有挂载认证，因此没有账号或权限组可管理。',
  loading: '正在读取账号与权限组…',
  loadFailed: '读取失败',
  retry: '重试',
  usersTitle: '账号',
  usersIntro: '此部署的全部账号。新账号的初始密码由你转交给本人。',
  usersEmpty: '还没有任何账号。',
  newUserEmail: '邮箱地址',
  newUserPassword: '初始密码',
  createUser: '创建账号',
  disable: '停用',
  enable: '恢复',
  disableUser: '停用 {email}',
  enableUser: '恢复 {email}',
  disabledBadge: '已停用',
  unverifiedBadge: '邮箱未确认',
  groupsTitle: '权限组',
  groupsIntro: '选中一个组来编辑它的成员与规则。',
  newGroupName: '组名',
  createGroup: '创建组',
  selectGroup: '编辑 {name}',
  renameGroup: '重命名 {name}',
  rename: '重命名',
  deleteGroup: '删除 {name}',
  delete: '删除',
  builtinGroup: '内置组',
  builtinLocked: '内置管理员组不能重命名或删除：成为它的成员正是成为管理员的方式。',
  membersTitle: '成员',
  membersIntro: '勾选属于 {name} 的账号。新加入的成员会收到一封通知邮件。',
  memberToggle: '{email} 属于 {name}',
  rulesTitle: '规则',
  rulesIntro: '规则以域为单位生效。某个域一旦有了第一条规则，整个域就变成白名单：拒绝优先于允许，没有匹配规则即拒绝。',
  domainSkill: '技能',
  domainTool: '工具',
  domainModel: '模型',
  domainSettingsSection: '设置命名空间',
  rulePattern: '名称或以 * 结尾的前缀',
  ruleDomain: '域',
  ruleEffect: '效果',
  effectAllow: '允许',
  effectDeny: '拒绝',
  addRule: '添加规则',
  removeRule: '删除规则：{effect} {domain} {pattern}',
  remove: '删除',
  saveRules: '保存规则',
  discardRules: '放弃修改',
  unsaved: '有未保存的修改；下面的预览已经按它们计算。',
  seeded: '本次添加同时补上了一条 {pattern} 允许规则，否则这一条拒绝会把该域的其他名称也一并挡掉。它是一条普通规则，删掉即可得到严格白名单。',
  warnLocked: '{domain}：这些规则不允许任何名称。{name} 的成员将失去该域下的全部内容。',
  warnAllowlist: '{domain}：只有列出的允许规则生效，该域下其他所有名称都会被拒绝。',
  reachOpen: '{domain}：没有规则，全部开放。',
  reachOpenWithExceptions: '{domain}：除写明的拒绝之外全部开放。',
  reachAllowlist: '{domain}：白名单，仅限写明的允许。',
  reachLocked: '{domain}：全部拒绝。',
  previewTitle: '成员将看到什么',
  previewIntro: '按当前规则（含未保存的修改）计算，{name} 的普通成员能看到的内容。管理员不受规则限制，因此这里算的不是你自己。',
  previewNoSession: '技能按会话的工作目录发现，请先打开一个会话才能预览真实的技能清单。',
  previewSkillsEmpty: '本项目没有发现任何技能。',
  previewVisible: '可见技能（{count}）：{names}',
  previewHidden: '被拒绝的技能（{count}）：{names}',
  previewNoneHidden: '没有技能被拒绝。',
  saveFailed: '保存失败',
  actionFailed: '操作失败',
}

/** English strings (same key set as {@link zh}). */
export const en: Record<keyof typeof zh, string> = {
  nav: 'Access',
  title: 'Access',
  intro: 'Accounts, permission groups, membership, and the rules each group carries.',
  adminOnly: 'Only an administrator can manage accounts and permission groups. Hiding this page merely spares you a form that would not work: what actually refuses the request is the Host, which rejects every administration call from a non-administrator.',
  notAuthenticating: 'This deployment mounts no authentication, so there are no accounts or groups to administer.',
  loading: 'Reading accounts and groups…',
  loadFailed: 'Reading failed',
  retry: 'Retry',
  usersTitle: 'Accounts',
  usersIntro: 'Every account in this deployment. Delivering a new account’s first password to its owner is your job.',
  usersEmpty: 'There are no accounts yet.',
  newUserEmail: 'E-mail address',
  newUserPassword: 'Initial password',
  createUser: 'Create account',
  disable: 'Disable',
  enable: 'Restore',
  disableUser: 'Disable {email}',
  enableUser: 'Restore {email}',
  disabledBadge: 'Disabled',
  unverifiedBadge: 'Address unconfirmed',
  groupsTitle: 'Groups',
  groupsIntro: 'Select a group to edit its membership and its rules.',
  newGroupName: 'Group name',
  createGroup: 'Create group',
  selectGroup: 'Edit {name}',
  renameGroup: 'Rename {name}',
  rename: 'Rename',
  deleteGroup: 'Delete {name}',
  delete: 'Delete',
  builtinGroup: 'Builtin',
  builtinLocked: 'The builtin administrator group cannot be renamed or deleted: membership in it is what makes an administrator.',
  membersTitle: 'Membership',
  membersIntro: 'Tick the accounts that belong to {name}. Newly added members are mailed a notice.',
  memberToggle: '{email} belongs to {name}',
  rulesTitle: 'Rules',
  rulesIntro: 'Rules apply per domain. The first rule addressing a domain turns that whole domain into an allowlist: deny beats allow, and a name no rule matches is refused.',
  domainSkill: 'Skills',
  domainTool: 'Tools',
  domainModel: 'Models',
  domainSettingsSection: 'Settings namespaces',
  rulePattern: 'Name, or a prefix ending in *',
  ruleDomain: 'Domain',
  ruleEffect: 'Effect',
  effectAllow: 'Allow',
  effectDeny: 'Deny',
  addRule: 'Add rule',
  removeRule: 'Remove rule: {effect} {domain} {pattern}',
  remove: 'Remove',
  saveRules: 'Save rules',
  discardRules: 'Discard changes',
  unsaved: 'Unsaved changes; the preview below already counts them.',
  seeded: 'A {pattern} allow rule was added alongside it — without one, this single denial would also refuse every other name in the domain. It is an ordinary rule: delete it to get a strict allowlist.',
  warnLocked: '{domain}: these rules admit no name at all. Members of {name} lose everything in this domain.',
  warnAllowlist: '{domain}: only the listed allow rules apply, and every other name in this domain is refused.',
  reachOpen: '{domain}: no rules, fully open.',
  reachOpenWithExceptions: '{domain}: open except for the written denials.',
  reachAllowlist: '{domain}: allowlist, limited to the written allows.',
  reachLocked: '{domain}: everything refused.',
  previewTitle: 'What a member would see',
  previewIntro: 'Resolved from the current rules, unsaved changes included, for an ordinary member of {name}. An administrator bypasses rules, so this is not you.',
  previewNoSession: 'Skills are discovered from a session’s working directory. Open a session to preview against the real catalog.',
  previewSkillsEmpty: 'This project discovers no skills.',
  previewVisible: 'Skills visible ({count}): {names}',
  previewHidden: 'Skills refused ({count}): {names}',
  previewNoneHidden: 'No skill is refused.',
  saveFailed: 'Saving failed',
  actionFailed: 'The operation failed',
}

/** Copy keys this plugin's namespace owns. */
export type AccessKey = keyof typeof zh

/** Bound translate for this namespace. */
export type AccessTranslate = (key: AccessKey, params?: Record<string, unknown>) => string

/** Copy key per rule domain; the domain vocabulary is closed, so every one is named. */
const DOMAIN_KEYS: Readonly<Record<AccessDomain, AccessKey>> = {
  skill: 'domainSkill',
  tool: 'domainTool',
  model: 'domainModel',
  'settings-section': 'domainSettingsSection',
}

/**
 * Localized title for one rule domain.
 * @param domain - the namespace a rule addresses.
 * @param t - this namespace's bound translate.
 * @returns the localized domain name.
 */
export function domainLabel(domain: AccessDomain, t: AccessTranslate): string {
  return t(DOMAIN_KEYS[domain])
}
