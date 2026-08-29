/**
 * The session header's "open output" action.
 *
 * It exists only while the session has produced something to open — the same
 * located-path reading the files mode auto-locates on, so the button and the
 * panel agree by construction. A session that produced nothing renders no
 * button at all rather than a disabled one, because there is nothing the user
 * could do to enable it. The condition is asked as "has this window any
 * located path" (`allLocatedPaths`), which is the exported form of the same
 * fact the mode's auto-locate reads.
 */
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { allLocatedPaths } from '@deepseek-ai/dsh-client-ui-sci-files/client'
import type { OpenArtifactsActionProps } from './contract.ts'
import css from './OpenArtifactsAction.module.css'

/** The details-column mode this action brings forward. */
const FILES_MODE = 'files'

/**
 * Render the open-output action.
 * @param props - the session seat and the panel gesture.
 * @returns the button, or null while the session has produced nothing.
 */
export function OpenArtifactsAction({ useSession, showDetailsMode, t }: OpenArtifactsActionProps) {
  const produced = useSession((snapshot: ConversationSnapshot) => allLocatedPaths(snapshot.nodes).length)
  if (produced === 0) return null
  const label = t('header.openArtifacts')
  return (
    <button
      type="button"
      className={css.action}
      title={label}
      onClick={() => { showDetailsMode(FILES_MODE) }}
    >
      {label}
    </button>
  )
}
