/**
 * The live half of auto-locate: bringing the column forward when the session
 * produces a file.
 *
 * Which file the mode shows is derived at render (see `auto-locate.ts`), so
 * this watcher decides only *when to interrupt the user*. That has to be a
 * live fact, never a replayed one: a conversation-event Definition folds the
 * whole window on every session load, and switching tabs from inside that
 * fold would yank the panel open on every page refresh. Watching the
 * assembled snapshot instead makes the first reading a baseline and only a
 * later change an event.
 */
import type {
  ConversationSnapshot, ObservableSnapshot, SessionId, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { latestLocatedPath } from './auto-locate.ts'

/** The narrow sessions face this watcher reads (the whole test double it needs). */
export interface ProducedFileSessions {
  /** The session list, whose `current` names the session on screen. */
  readonly list: ObservableSnapshot<SessionListState>
  /**
   * The assembled handle for one session.
   * @param id - session id.
   * @returns the handle, or undefined before that session is assembled.
   */
  binding: (id: SessionId) => { readonly session: ObservableSnapshot<ConversationSnapshot> } | undefined
}

/**
 * The newest file the current session has produced, read once. The pin
 * `ctx.sciFiles.locate` records needs the same reading the mode derives at
 * render, so a locate made while nothing newer exists keeps outranking
 * auto-locate until the next delivery.
 * @param sessions - the sessions service.
 * @returns the produced path, or undefined with no current or assembled session.
 */
export function currentProducedPath(sessions: ProducedFileSessions): string | undefined {
  const current = sessions.list.getSnapshot().current
  if (current === undefined) return undefined
  const session = sessions.binding(current)?.session
  return session === undefined ? undefined : latestLocatedPath(session.getSnapshot().nodes)
}

/**
 * Call `onProduced` whenever the current session produces a file after this
 * watcher started following it.
 *
 * Following moves with the current session, and each session starts from its
 * own baseline — switching to a session that already delivered something
 * reports nothing, because nothing just happened. A session that is current
 * but not yet assembled is retried on the next list change.
 * @param sessions - the sessions service.
 * @param onProduced - fired once per newly produced file.
 * @returns disposer detaching from both the list and the followed session.
 */
export function watchProducedFiles(sessions: ProducedFileSessions, onProduced: () => void): () => void {
  let followedId: SessionId | undefined
  let unfollow: (() => void) | undefined
  let seen: string | undefined

  const follow = (): void => {
    const current = sessions.list.getSnapshot().current
    if (current === followedId && unfollow !== undefined) return
    unfollow?.()
    unfollow = undefined
    followedId = current
    if (current === undefined) return
    const session = sessions.binding(current)?.session
    if (session === undefined) {
      // Current but not assembled yet; clearing the id makes the next list
      // change retry instead of treating this as a settled follow.
      followedId = undefined
      return
    }
    // The baseline: whatever this session had already produced is history,
    // and history does not open panels.
    seen = latestLocatedPath(session.getSnapshot().nodes)
    unfollow = session.subscribe(() => {
      const path = latestLocatedPath(session.getSnapshot().nodes)
      if (path === seen) return
      seen = path
      // A window that scrolled its last producing call out of view changes
      // the reading to undefined; that is a loss of evidence, not a delivery.
      if (path !== undefined) onProduced()
    })
  }

  follow()
  const unlist = sessions.list.subscribe(follow)
  return () => {
    unlist()
    unfollow?.()
  }
}
