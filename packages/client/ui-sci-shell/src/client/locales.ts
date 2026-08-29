/** `sci-shell` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'sci-shell'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'rail.brand': 'CaMeL Science',
  'rail.conversation': '研究流',
  'theme.toLight': '切换到浅色',
  'theme.toDark': '切换到深色',
  'profile.open': '账户',
  'profile.close': '关闭账户浮层',
  'profile.loading': '正在读取账户…',
  'profile.offline': '未登录网关',
  'profile.role': '{role}',
  'profile.roleTenant': '{role} · {tenant}',
  'profile.vm': '{slug} · {image}',
  'profile.balance': '余额 ${amount}',
  'profile.exhausted': '已用尽',
  'profile.logout': '退出登录',
}

/** English dictionary (same key set). */
export const en: Record<SciShellKey, string> = {
  'rail.brand': 'CaMeL Science',
  'rail.conversation': 'Research flow',
  'theme.toLight': 'Switch to light',
  'theme.toDark': 'Switch to dark',
  'profile.open': 'Account',
  'profile.close': 'Close the account popover',
  'profile.loading': 'Reading the account…',
  'profile.offline': 'Not signed in to the gate',
  'profile.role': '{role}',
  'profile.roleTenant': '{role} · {tenant}',
  'profile.vm': '{slug} · {image}',
  'profile.balance': 'Balance ${amount}',
  'profile.exhausted': 'Exhausted',
  'profile.logout': 'Sign out',
}

/** Key union of this plugin's dictionaries. */
export type SciShellKey = keyof typeof zh
