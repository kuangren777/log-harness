import * as React from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  opensFloatingWindow, turnFilesOfSession, type UniverTurnOperation,
} from '../conversation/univer-turn-definition.ts'
import { useUniverStates } from '../hooks/use-univer-state.ts'
import type { ViewerLocaleInjected } from '../viewer-locale.ts'
import { WorktreeWindow } from './worktree-window.tsx'

export type UniverDockProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'univer'> & ViewerLocaleInjected

interface OpenWindow {
  readonly file: string
  readonly worktreeId: string | null
  readonly preferredUnitId: string | null
}

/** Own deliberate live-window intent across Turns and clear it only on dismiss or terminal state. */
export function UniverDock(props: UniverDockProps): React.ReactElement {
  return <UniverSessionDock key={props.sessionId} {...props} />
}

/** A keyed owner prevents open-window intent from crossing DSH session boundaries. */
function UniverSessionDock(props: UniverDockProps): React.ReactElement {
  const cwd = props.useSessions(state => state.byId[props.sessionId]?.cwd)
  const turnFiles = React.useMemo(() => turnFilesOfSession(props.session, cwd), [props.session, cwd])
  const [open, setOpen] = React.useState<Record<string, OpenWindow>>({})
  const seen = React.useRef(new Set<string>())
  const running = props.session.running

  React.useEffect(() => {
    const additions: OpenWindow[] = []
    for (const file of turnFiles) {
      for (const operation of file.operations) {
        if (operation.phase === 'failed' || !opensFloatingWindow(operation)) continue
        const candidate = openWindowOf(operation, file.file)
        if (candidate === null || seen.current.has(operation.callId)) continue
        seen.current.add(operation.callId)
        additions.push(candidate)
      }
    }
    if (additions.length === 0) return
    setOpen((previous) => {
      const next = { ...previous }
      for (const addition of additions) next[addition.file] = addition
      return next
    })
  }, [turnFiles])

  const files = Object.keys(open)
  const { states } = useUniverStates(running ? files : [], props.sessionId)

  React.useEffect(() => {
    setOpen((previous) => {
      let changed = false
      const next = { ...previous }
      for (const target of Object.values(previous)) {
        if (target.worktreeId === null) continue
        const worktree = states[target.file]?.worktrees.find(entry => entry.worktreeId === target.worktreeId)
        if (worktree?.status === 'merged' || worktree?.status === 'discarded') {
          // Immutable update of a plain state record; a Map here would change
          // the type every component below reads.
          // oxlint-disable-next-line typescript/no-dynamic-delete
          delete next[target.file]
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [states])

  if (!running) return <></>
  const windows = Object.values(open)
  return <>{windows.length === 0 ? null : <div className="uvf_root">{windows.map((target, stackIndex) => <WorktreeWindow
    key={target.file}
    file={target.file}
    state={states[target.file]}
    worktreeId={target.worktreeId}
    preferredUnitId={target.preferredUnitId}
    stackIndex={stackIndex}
    t={props.t}
    viewerLocale={props.getViewerLocale()}
    onDismiss={() => { setOpen((previous) => {
      const next = { ...previous }
      // oxlint-disable-next-line typescript/no-dynamic-delete -- see above.
      delete next[target.file]
      return next
    }) }}
  />)}</div>}</>
}

function openWindowOf(operation: UniverTurnOperation, file: string): OpenWindow | null {
  if (operation.name === 'new') return { file, worktreeId: null, preferredUnitId: operation.unitId }
  if (operation.worktreeId === null) return null
  return { file, worktreeId: operation.worktreeId, preferredUnitId: operation.unitId }
}
