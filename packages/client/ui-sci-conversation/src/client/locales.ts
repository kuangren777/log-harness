/** `sci-conversation` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'sci-conversation'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'card.running': '运行中',
  'card.done': '完成',
  'card.failed': '失败',
  'card.openDetails': '在右侧打开详情',
  'card.inspect': '轨迹',
  'card.expand': '展开调用详情',
  'card.collapse': '收起调用详情',
  'card.elapsed': '{seconds} 秒',
  'galaxy.title': '智能体星系 · 实时执行',
  'galaxy.center': '主编',
  'galaxy.centerRole': '汇总裁决',
  'galaxy.turnElapsed': '本轮已用 {seconds} 秒',
  'galaxy.turnTokens': '本轮输出 {tokens} tokens',
  'galaxy.columnTokens': 'token',
  'galaxy.empty': '这一轮还没有子智能体。',
  'artifacts.title': '研究产出 · 点击在右侧打开',
  'artifacts.open': '在右侧打开 {name}',
  'header.openArtifacts': '打开产出',
  'model.official': '官方输入 {input} / 1M · 输出 {output} / 1M · 缓存命中 {cached} / 1M',
  'model.ratio': '倍率 ×{ratio} → 实际输入 {input} / 输出 {output}',
}

/** English dictionary (same key set). */
export const en: Record<SciConversationKey, string> = {
  'card.running': 'Running',
  'card.done': 'Done',
  'card.failed': 'Failed',
  'card.openDetails': 'Open the details column',
  'card.inspect': 'Trajectory',
  'card.expand': 'Expand the call',
  'card.collapse': 'Collapse the call',
  'card.elapsed': '{seconds}s',
  'galaxy.title': 'Agent galaxy · live',
  'galaxy.center': 'Editor',
  'galaxy.centerRole': 'Merges and decides',
  'galaxy.turnElapsed': '{seconds}s this turn',
  'galaxy.turnTokens': '{tokens} output tokens this turn',
  'galaxy.columnTokens': 'token',
  'galaxy.empty': 'No subagent ran in this turn.',
  'artifacts.title': 'Research output · click to open on the right',
  'artifacts.open': 'Open {name} on the right',
  'header.openArtifacts': 'Open output',
  'model.official': 'List input {input} / 1M · output {output} / 1M · cache hit {cached} / 1M',
  'model.ratio': 'Multiplier ×{ratio} → effective input {input} / output {output}',
}

/** Key union of this plugin's dictionaries. */
export type SciConversationKey = keyof typeof zh
