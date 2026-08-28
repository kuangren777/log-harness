/** Simplified Chinese UI strings. */
export const zh = {
  title: 'Univer 预览', expand: '展开预览', collapse: '收起预览', refresh: '刷新',
  'gateway.running': 'Univer Gateway 运行中', 'gateway.stopped': 'Univer Gateway 未运行，点击启动',
  'gateway.starting': '正在启动 Univer Gateway…', 'gateway.checking': '正在检查 Univer Gateway…', 'gateway.failed': 'Univer Gateway 不可用，点击重试',
  'dock.live': '实时同步', 'dock.draft': '修改中', 'dock.ready': '待确认', 'dock.mergeReady': '待确认',
  'dock.unit.added': '新', 'dock.unit.modified': '改', 'dock.unit.deleted': '删', 'dock.unit.conflict': '冲突',
  'dock.fold': '折叠', 'dock.expand': '展开', 'dock.maximize': '放大', 'dock.restore': '还原', 'dock.close': '关闭',
  'dock.gatewayDown': 'Univer Gateway 未运行，无法实时预览', 'dock.startGateway': '启动 Gateway',
  'dock.mergeTitle': '合并预览', 'dock.reviewTitle': '正在进行的修改', 'dock.markReady': '提交确认',
  'dock.merged': '已合入', 'dock.discarded': '已丢弃', 'dock.mergedTitle': '修改已合入', 'dock.discardedTitle': '修改已丢弃',
  'dock.fullscreen': '全屏审阅', 'dock.exitFullscreen': '退出全屏',
  'dock.currentVersion': '当前版本', 'dock.loading': '正在加载', 'dock.unavailable': '暂不可用',
  'dock.notReady': '提交确认后，可以合入或丢弃这处修改', 'dock.merge': '合入当前版本', 'dock.discard': '丢弃',
} as const

/** Translation keys owned by the Univer browser surfaces. */
export type UniverLocaleKey = keyof typeof zh
