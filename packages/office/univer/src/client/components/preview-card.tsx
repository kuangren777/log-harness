import * as React from 'react'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  outcomeOfTurnFile, resolveTurnFiles, type UniverTurnFile, type UniverTurnMatch,
} from '../conversation/univer-turn-definition.ts'
import { useUniverStates } from '../hooks/use-univer-state.ts'
import type { ViewerLocaleInjected } from '../viewer-locale.ts'
import { ReviewPanel } from './review-panel.tsx'

export type PreviewCardProps = PropsRuntime<'conversation.chat.turnTail'> & PropsLocale<'univer'> & ViewerLocaleInjected & { readonly matched: UniverTurnMatch }

/** Render one unified Univer card for every file touched during the owning Turn. */
export function PreviewCard(props: PreviewCardProps): React.ReactElement {
  const session = props.useSession(snapshot => snapshot)
  const cwd = props.useSessions(state => state.byId[props.sessionId]?.cwd)
  const files = React.useMemo(() => resolveTurnFiles(props.matched.files, cwd), [props.matched.files, cwd])
  const { states, missingFiles } = useUniverStates(files.map(entry => entry.file), props.sessionId)
  const latestTurns = React.useMemo(() => latestWorktreeTurns(session), [session])
  return <>{files.map((target) => {
    // Bash or another tool may remove a temporary file after its structured Univer operations.
    // The Host's current workspace state is authoritative, so no historical shell is rendered.
    if (missingFiles.has(target.file)) return null
    const outcome = outcomeOfTurnFile(target)
    const worktreeId = outcome.primaryWorktreeId ?? pendingWorktree(target)
    const historical = worktreeId !== null && latestTurns.get(worktreeId) !== props.matched.turn
    return <ReviewPanel
      key={target.file}
      file={target.file}
      state={states[target.file]}
      worktreeId={worktreeId}
      preferredUnitId={outcome.preferredUnitId}
      historical={historical}
      t={props.t}
      viewerLocale={props.getViewerLocale()}
    />
  })}</>
}

function pendingWorktree(target: UniverTurnFile): string | null {
  for (let index = target.operations.length - 1; index >= 0; index -= 1) {
    const operation = target.operations[index]
    if (operation !== undefined && operation.worktreeId !== null) return operation.worktreeId
  }
  return null
}

function latestWorktreeTurns(session: ConversationSnapshot): Map<string, number> {
  const latest = new Map<string, number>()
  for (const [turnNumber, turn] of session.chat.timeline.turns) {
    const data = turn.data.get('univerTurn')
    if (data === undefined) continue
    for (const file of data.files) {
      for (const operation of file.operations) {
        if (operation.worktreeId !== null) latest.set(operation.worktreeId, turnNumber)
      }
    }
  }
  return latest
}
