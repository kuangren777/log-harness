/** `sci-files` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'sci-files'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'files.tab': '文件',
  'tree.loading': '加载中…',
  'tree.empty': '这个文件夹是空的。',
  'tree.versions': '只读归档',
  'tree.error.path-out-of-scope': '这个目录在会话项目目录之外。',
  'tree.error.file-not-found': '目录不存在，可能已被移动或删除。',
  'tree.error.not-a-directory': '这个路径不是目录。',
  'tree.error.too-many-entries': '条目过多，无法列出这个目录。',
  'tree.error.session-not-found': '会话未连接，无法列出目录。',
  'tree.error.cancelled': '列目录已取消。',
  'tree.error.internal': '列目录失败。',
  'preview.none': '在上方选择一个文件。',
  'preview.loading': '正在读取…',
  'preview.size': '{size} · {mediaType}',
  'preview.binary': '这个文件不能在浏览器里预览。',
  'preview.error.file-not-found': '文件不存在，可能已被移动或删除。',
  'preview.error.not-a-file': '这个路径不是普通文件。',
  'preview.error.file-too-large': '文件超出预览上限，请在沙箱里直接打开。',
  'preview.error.path-out-of-scope': '这个路径在会话项目目录之外。',
  'preview.error.session-not-found': '会话未连接，无法读取文件。',
  'preview.error.cancelled': '读取已取消。',
  'preview.error.internal': '读取失败。',
  'office.loading': '正在连接 Office 运行时…',
  'office.connected': '协同已连接',
  'office.readonly': '协同未连接，文档为只读。',
  'office.unavailable': 'Office 运行时不可用，无法打开这个文档。',
  'office.title': '{name} 的 Office 预览',
}

/** English dictionary (same key set). */
export const en: Record<SciFilesKey, string> = {
  'files.tab': 'Files',
  'tree.loading': 'Loading…',
  'tree.empty': 'This folder is empty.',
  'tree.versions': 'Read-only archive',
  'tree.error.path-out-of-scope': 'This directory is outside the session project directory.',
  'tree.error.file-not-found': 'The directory does not exist; it may have been moved or removed.',
  'tree.error.not-a-directory': 'This path is not a directory.',
  'tree.error.too-many-entries': 'This directory holds too many entries to list.',
  'tree.error.session-not-found': 'The session is not attached, so the directory cannot be listed.',
  'tree.error.cancelled': 'The listing was cancelled.',
  'tree.error.internal': 'The listing failed.',
  'preview.none': 'Select a file above.',
  'preview.loading': 'Reading…',
  'preview.size': '{size} · {mediaType}',
  'preview.binary': 'This file cannot be previewed in the browser.',
  'preview.error.file-not-found': 'The file does not exist; it may have been moved or removed.',
  'preview.error.not-a-file': 'This path is not a regular file.',
  'preview.error.file-too-large': 'The file is past the preview cap; open it in the sandbox instead.',
  'preview.error.path-out-of-scope': 'This path is outside the session project directory.',
  'preview.error.session-not-found': 'The session is not attached, so the file cannot be read.',
  'preview.error.cancelled': 'The read was cancelled.',
  'preview.error.internal': 'The read failed.',
  'office.loading': 'Connecting to the office runtime…',
  'office.connected': 'Collaboration connected',
  'office.readonly': 'Collaboration is not connected; the document is read-only.',
  'office.unavailable': 'The office runtime is unavailable, so this document cannot be opened.',
  'office.title': 'Office preview of {name}',
}

/** Union of this namespace's dictionary keys. */
export type SciFilesKey = keyof typeof zh
