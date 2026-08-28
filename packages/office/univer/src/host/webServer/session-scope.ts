import { SessionId, type SessionStore } from '@deepseek-ai/dsh-session'
import { UniverError } from '../service/errors.ts'
import { resolveExistingUniverPath } from '../service/workspace.ts'

/**
 * Resolve a browser file only when it belongs to the addressed live session.
 * @param value - the `file` field as it arrived over the wire.
 * @param sessionId - the `sessionId` field as it arrived over the wire.
 * @param sessions - the store the session is looked up in.
 * @returns the authorized workspace and the resolved absolute path.
 * @throws {UniverError} when either field is missing, the session is gone, or
 * the path lies outside that session's workspace.
 */
export async function resolveAuthorizedFile(
  value: unknown,
  sessionId: unknown,
  sessions: SessionStore,
): Promise<ReturnType<typeof resolveExistingUniverPath>> {
  if (typeof value !== 'string' || value.length === 0) {
    throw new UniverError('file is required', 'INVALID_REQUEST')
  }
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new UniverError('sessionId is required', 'INVALID_REQUEST')
  }
  const cwd = sessions.get(SessionId(sessionId))?.header.cwd
  if (cwd === undefined) throw new UniverError('session is unavailable or has no workspace', 'SESSION_SCOPE_UNAVAILABLE')
  return resolveExistingUniverPath(cwd, value)
}
