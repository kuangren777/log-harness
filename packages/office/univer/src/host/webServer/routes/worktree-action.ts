import type { SessionStore } from '@deepseek-ai/dsh-session'
import type { WorktreeReviewAction } from '../../../shared/wire/actions.ts'
import type { UniverService } from '../../service/univer-service.ts'
import { worktreeId } from '../../service/identifiers.ts'
import { UniverError } from '../../service/errors.ts'
import { resolveAuthorizedFile } from '../session-scope.ts'

/** Parsed worktree action request body. */
export interface WorktreeActionBody {
  /** The review decision to apply. */
  readonly action: WorktreeReviewAction
  /** Absolute path of the `.univer` file. */
  readonly file: string
  /** The session whose workspace authorizes the path. */
  readonly sessionId: string
  /** The worktree the decision applies to. */
  readonly worktreeId: string
}

/**
 * Validate and execute one browser-owned worktree review action.
 * @param service - the Univer Provider.
 * @param sessions - the store the addressed session is looked up in.
 * @param body - the parsed request body, still untrusted.
 * @returns the decision's outcome and the refreshed file state.
 * @throws {UniverError} when the body is malformed or does not authorize the path.
 */
export async function worktreeActionRoute(
  service: UniverService,
  sessions: SessionStore,
  body: unknown,
): ReturnType<UniverService['worktreeAction']> {
  if (!isObject(body)) throw new UniverError('JSON object body is required', 'INVALID_REQUEST')
  const action = body.action
  if (action !== 'ready' && action !== 'reopen' && action !== 'discard' && action !== 'merge') {
    throw new UniverError('action must be ready | reopen | discard | merge', 'INVALID_REQUEST')
  }
  if (typeof body.worktreeId !== 'string' || body.worktreeId.length === 0) {
    throw new UniverError('worktreeId is required', 'INVALID_REQUEST')
  }
  const authorized = await resolveAuthorizedFile(body.file, body.sessionId, sessions)
  return service.worktreeAction({
    action,
    workspace: authorized.workspace,
    file: authorized.path,
    worktreeId: worktreeId(body.worktreeId),
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
