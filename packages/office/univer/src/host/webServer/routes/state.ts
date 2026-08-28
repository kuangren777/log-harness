import type { SessionStore } from '@deepseek-ai/dsh-session'
import type { UniverService } from '../../service/univer-service.ts'
import { resolveAuthorizedFile } from '../session-scope.ts'

/**
 * Read one file's current worktree state.
 * @param service - the Univer Provider.
 * @param sessions - the store the addressed session is looked up in.
 * @param file - the `file` query parameter as it arrived.
 * @param sessionId - the `sessionId` query parameter as it arrived.
 * @returns that file's worktrees and Viewer targets.
 * @throws {UniverError} when the request does not authorize the path.
 */
export async function stateRoute(
  service: UniverService,
  sessions: SessionStore,
  file: unknown,
  sessionId: unknown,
): ReturnType<UniverService['fileState']> {
  const authorized = await resolveAuthorizedFile(file, sessionId, sessions)
  return service.fileState({ workspace: authorized.workspace, file: authorized.path })
}
