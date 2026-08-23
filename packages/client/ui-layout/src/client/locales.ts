/** `layout` namespace dictionaries: the phone frame's own chrome (drawer toggle and region name). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'drawer.label': '侧边栏',
  'drawer.open': '打开侧边栏',
  'drawer.close': '关闭侧边栏',
} satisfies Record<string, string>

/** The layout namespace key union. */
export type LayoutKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'drawer.label': 'Sidebar',
  'drawer.open': 'Open sidebar',
  'drawer.close': 'Close sidebar',
} satisfies Record<LayoutKey, string>
