/**
 * The details column's Files mode: the project tree over the preview of one
 * file, split vertically because the column is narrow.
 *
 * Which file shows is two facts, not one. A row the user clicked pins the
 * selection and nothing moves it again. Until then the mode follows the
 * newest file the session produced — a delivery, an export, a new
 * document — derived from the conversation snapshot at render, so opening the
 * tab lands on the thing that was just made and its folders are already open.
 * Clearing the pin returns the mode to following.
 */
import { useMemo } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SciFilesInjected } from './contract.ts'
import type { SciFilesStore } from './stores.ts'
import { FilePreview } from './FilePreview.tsx'
import { FileTree } from './FileTree.tsx'
import { ancestorsOf } from './paths.ts'
import { latestLocatedPath } from './auto-locate.ts'
import { shownPath } from './stores.ts'
import css from './FilesMode.module.css'

/** Full props of the Files mode entry, composed from the four shares. */
export type FilesModeProps =
  PropsRuntime<'conversation.details.mode'>
  & PropsStore<SciFilesStore>
  & SciFilesInjected
  & PropsLocale<'sci-files'>

/**
 * Render the Files mode.
 * @param props - the mode's composed slot props.
 * @returns the tree-over-preview split, or nothing while another mode shows.
 */
export function FilesMode({
  cwd, active, sessionId, useSession, useStore, actions, listDirectory, readFile, officeState, t,
}: FilesModeProps) {
  const pinned = useStore(s => s.pinned)
  const opened = useStore(s => s.expanded)
  // Pure derivation over the framework session hook: no subscription, no
  // stored copy, and a reloaded session lands where the live one did.
  const produced = useSession(s => latestLocatedPath(s.nodes))
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

  return (
    <div className={css.root}>
      {cwd !== undefined && (
        <div className={css.tree}>
          <FileTree
            sessionId={sessionId}
            root={cwd}
            expanded={expanded}
            selectedPath={selected}
            listDirectory={listDirectory}
            onToggle={actions.toggleExpanded}
            onSelect={(path) => { actions.pin(path, produced ?? null) }}
            t={t}
          />
        </div>
      )}
      <div className={css.preview}>
        <FilePreview sessionId={sessionId} path={selected} readFile={readFile} officeState={officeState} t={t} />
      </div>
    </div>
  )
}
