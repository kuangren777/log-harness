/**
 * The details column's Files mode: a panel header over the produced-file
 * strip, the project tree, and the preview of one file.
 *
 * Which file shows is two facts, not one. A row the user clicked pins the
 * selection and nothing moves it again. Until then the mode follows the
 * newest file the session produced — a delivery, an export, a new
 * document — derived from the conversation snapshot at render, so opening the
 * tab lands on the thing that was just made and its folders are already open.
 * Clearing the pin returns the mode to following.
 *
 * The preview owns the read and publishes what it got, so the header's size
 * line, the source reading, and the download all describe the same bytes. It
 * stays mounted while the source reading shows: unmounting it would drop
 * those bytes and read the file again on the way back.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SciFileContent, SciFilesInjected } from './contract.ts'
import type { PanelView } from './PanelHeader.tsx'
import { FilePreview } from './FilePreview.tsx'
import { FileTree } from './FileTree.tsx'
import { PanelHeader } from './PanelHeader.tsx'
import { TypeChips } from './TypeChips.tsx'
import { ancestorsOf } from './paths.ts'
import { allLocatedPaths, latestLocatedPath } from './auto-locate.ts'
import { previewKindFor } from './media.ts'
import { shownPath } from './stores.ts'
import { triggerDownload } from './download.ts'
import css from './FilesMode.module.css'

/** Full props of the Files mode entry, composed from its three shares. */
export type FilesModeProps =
  PropsRuntime<'conversation.details.mode'>
  & SciFilesInjected
  & PropsLocale<'sci-files'>

/** Preview renderers whose file also has a source reading worth showing. */
const SOURCE_KINDS: ReadonlySet<string> = new Set(['markdown', 'text', 'office'])

/**
 * Render the Files mode.
 * @param props - the mode's composed slot props.
 * @returns the header-over-tree-over-preview panel, or nothing while another mode shows.
 */
export function FilesMode({
  cwd, active, sessionId, useSession, files, listDirectory, readFile, officeState, t,
}: FilesModeProps) {
  // Bound through the instance rather than passed as methods, and stable per
  // instance so the subscription is not torn down on every render.
  const subscribe = useCallback((onChange: () => void) => files.subscribe(onChange), [files])
  const readState = useCallback(() => files.getSnapshot(), [files])
  const state = useSyncExternalStore(subscribe, readState)
  const [view, setView] = useState<PanelView>('preview')
  const [file, setFile] = useState<SciFileContent | null>(null)
  const pinned = state.pinned
  const opened = state.expanded
  // Pure derivations over the framework session hook: no subscription, no
  // stored copy, and a reloaded session lands where the live one did.
  const nodes = useSession(s => s.nodes)
  const produced = useMemo(() => latestLocatedPath(nodes), [nodes])
  const artifacts = useMemo(() => allLocatedPaths(nodes), [nodes])
  const selected = shownPath(pinned, produced)
  // A followed selection opens its own ancestry so the tree reveals it; a
  // pinned one was reached by opening those directories in the first place,
  // so the user's collapses are left alone.
  const followed = selected === pinned?.path ? undefined : selected
  const expanded = useMemo(() => new Set(
    followed !== undefined && cwd !== undefined
      ? [...opened, ...ancestorsOf(followed, cwd)]
      : opened,
  ), [opened, followed, cwd])

  // The panel mounts the active mode alone today, but the owner publishes the
  // fact rather than implying it: a deselected mode draws nothing and asks
  // the backend for nothing.
  if (!active) return null

  // What a pick outranks: the same reading both the chips and the tree
  // record against, so either gesture yields to the next delivery alike.
  const over = produced ?? null
  // A file with no read behind it has no source to show, so the switch cannot
  // be left standing on one when the selection moves.
  const source = file !== null && SOURCE_KINDS.has(previewKindFor(file.mediaType)) ? file.content : null
  const canSource = source !== null
  const shown: PanelView = canSource ? view : 'preview'

  return (
    <div className={css.root}>
      <PanelHeader
        path={selected}
        file={file}
        view={shown}
        canSource={canSource}
        onView={setView}
        onDownload={(picked) => { triggerDownload(picked) }}
        t={t}
      />
      <TypeChips
        paths={artifacts}
        current={selected}
        onPick={(path) => { files.actions.pin(path, over) }}
        t={t}
      />
      {cwd !== undefined && (
        <div className={css.tree}>
          <FileTree
            sessionId={sessionId}
            root={cwd}
            expanded={expanded}
            selectedPath={selected}
            listDirectory={listDirectory}
            onToggle={files.actions.toggleExpanded}
            onSelect={(path) => { files.actions.pin(path, over) }}
            t={t}
          />
        </div>
      )}
      <div className={css.preview} hidden={shown === 'source'}>
        <FilePreview
          sessionId={sessionId}
          path={selected}
          readFile={readFile}
          officeState={officeState}
          onFile={setFile}
          t={t}
        />
      </div>
      {shown === 'source' && <pre className={css.source}>{source}</pre>}
    </div>
  )
}
