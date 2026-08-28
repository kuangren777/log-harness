/**
 * The project tree: one lazily listed level per open directory, rooted at the
 * session's project directory. Dot-prefixed rows never show (the workspace
 * picker's convention), and a `versions/` archive carries a read-only tag
 * because the sci workspace refuses edits inside it.
 *
 * A level is requested once, when it first becomes visible, and kept
 * afterwards — collapsing a directory does not discard what was read, so
 * reopening it is instant and the backend is asked once per panel life.
 */
import { useEffect, useRef, useState } from 'react'
import {
  IconChevronRightOutline14, IconFolderClose16, IconFolderOpen16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReactNode } from 'react'
import type { DirectoryOutcome, SciFileEntry } from './contract.ts'
import type { SciFilesKey } from './locales.ts'
import { isHiddenName, isVersionsDirectory } from './paths.ts'
import css from './FileTree.module.css'

/** Indentation one nesting level adds, in pixels. */
const LEVEL_INDENT = 12

/** Left padding of a root-level row, in pixels. */
const ROW_PADDING = 8

/**
 * Extra indent a file row takes so its name lines up with the folder names
 * beside it: the disclosure chevron's width plus the row gap it would sit in.
 */
const FILE_GUTTER = 18

/** Owner-supplied tree props: the levels to show, the wire call, and the two gestures. */
export interface FileTreeProps {
  /** Session whose project directory scopes every listed path. */
  sessionId: SessionId
  /** The session's project directory; the tree's always-listed root. */
  root: string
  /** Directories currently open, absolute paths. */
  expanded: ReadonlySet<string>
  /** The file the preview is showing, marked current in the rows. */
  selectedPath: string | undefined
  /** List one directory level. */
  listDirectory: (sessionId: SessionId, path: string) => Promise<DirectoryOutcome>
  /** A directory row was clicked. */
  onToggle: (path: string) => void
  /** A file row was clicked. */
  onSelect: (path: string) => void
  /** Localized tree copy. */
  t: Translate<SciFilesKey>
}

/** A level that has been requested: null while the request is in flight. */
type Level = DirectoryOutcome | null

/**
 * Render the lazily loaded project tree.
 * @param props - owner-controlled tree props.
 * @returns the tree element.
 */
export function FileTree({ sessionId, root, expanded, selectedPath, listDirectory, onToggle, onSelect, t }: FileTreeProps) {
  const [levels, setLevels] = useState<ReadonlyMap<string, Level>>(new Map())
  // Liveness is the component's, not one effect run's: recording the pending
  // placeholders re-runs the effect below, and a per-run flag would then
  // invalidate the very requests that run just issued.
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  useEffect(() => {
    // The root is always listed, and is also an ancestor the mode may have
    // opened: the set collapses that overlap before anything is requested.
    const missing = [...new Set([root, ...expanded])].filter(path => !levels.has(path))
    if (missing.length === 0) return
    setLevels((prev) => {
      const next = new Map(prev)
      for (const path of missing) next.set(path, null)
      return next
    })
    for (const path of missing) {
      void listDirectory(sessionId, path).then((outcome) => {
        // A settlement from a disposed panel must not write state; the tree
        // is remounted whole on the next tab visit and re-reads what it needs.
        if (!mounted.current) return
        setLevels(prev => new Map(prev).set(path, outcome))
      })
    }
  }, [sessionId, root, expanded, levels, listDirectory])

  // Mutually recursive by nature (a level renders rows, an open row renders
  // its level); function declarations hoist, so neither reads the other's
  // binding before it exists.
  function renderRow(entry: SciFileEntry, depth: number): ReactNode {
    const start = ROW_PADDING + depth * LEVEL_INDENT
    const indent = { paddingInlineStart: `${start}px` }
    const leafIndent = { paddingInlineStart: `${start + FILE_GUTTER}px` }
    if (entry.kind === 'file') {
      const current = entry.path === selectedPath
      return (
        <div key={entry.path} role="treeitem" aria-selected={current} className={css.seat}>
          <button
            type="button"
            style={leafIndent}
            className={current ? `${css.row} ${css.rowCurrent}` : css.row}
            onClick={() => { onSelect(entry.path) }}
          >
            <span className={css.name}>{entry.name}</span>
          </button>
        </div>
      )
    }
    if (entry.kind === 'other') {
      // A socket, device, or dangling symlink: it exists, so the tree says so,
      // but it has no bytes to preview and no level to open.
      return (
        <div key={entry.path} role="treeitem" className={css.seat}>
          <div style={leafIndent} className={`${css.row} ${css.rowInert}`}>
            <span className={css.name}>{entry.name}</span>
          </div>
        </div>
      )
    }
    const open = expanded.has(entry.path)
    return (
      <div key={entry.path} role="treeitem" aria-expanded={open} className={css.seat}>
        <button
          type="button"
          style={indent}
          className={css.row}
          onClick={() => { onToggle(entry.path) }}
        >
          <IconChevronRightOutline14 size={12} className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
          {open ? <IconFolderOpen16 size={16} className={css.icon} /> : <IconFolderClose16 size={16} className={css.icon} />}
          <span className={css.name}>{entry.name}</span>
          {isVersionsDirectory(entry.name) && <span className={css.tag}>{t('tree.versions')}</span>}
        </button>
        {open && <div role="group">{renderLevel(entry.path, depth + 1)}</div>}
      </div>
    )
  }

  function renderLevel(path: string, depth: number): ReactNode {
    const level = levels.get(path)
    if (level === undefined || level === null) return <div className={css.note}>{t('tree.loading')}</div>
    if (!level.ok) return <div className={css.note} role="alert">{t(`tree.error.${level.code}`)}</div>
    // The gateway lists dotfiles; hiding them is this client's decision, and
    // it matches the workspace directory picker's default.
    const rows = level.entries.filter(entry => !isHiddenName(entry.name))
    if (rows.length === 0) return <div className={css.note}>{t('tree.empty')}</div>
    return <>{rows.map(entry => renderRow(entry, depth))}</>
  }


  return <div className={css.root} role="tree">{renderLevel(root, 0)}</div>
}
