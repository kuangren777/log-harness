import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { FileState } from '../../shared/wire/state.ts'
import type { EnsureGatewayResult, UniverStatus } from '../../shared/wire/status.ts'

/** Error envelope returned by the Host browser API. */
interface ApiError { readonly message?: string; readonly code?: string }

/** Structured Host failure retained for UI decisions that depend on the error code. */
export class UniverApiError extends Error {
  /** Host error code, absent when the failure carried no classified code. */
  readonly code: string | undefined
  /** HTTP status the Host answered with. */
  readonly status: number

  constructor(message: string, code: string | undefined, status: number) {
    super(message)
    this.name = 'UniverApiError'
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${window.location.origin}${path}`, init)
  const body = await response.json() as T | ApiError
  if (!response.ok) {
    const error = body as ApiError
    throw new UniverApiError(error.message ?? `Univer API HTTP ${String(response.status)}`, error.code, response.status)
  }
  return body as T
}

/**
 * Read package, Gateway, and Unit content availability.
 * @returns the current status as the Host reports it.
 */
export function getUniverStatus(): Promise<UniverStatus> {
  return request('/univer-api/status')
}

/**
 * Start or reuse the bundled Gateway.
 * @returns the running Gateway origin, or the reason it stayed unavailable.
 */
export function startGateway(): Promise<EnsureGatewayResult> {
  return request('/univer-api/gateway/start', { method: 'POST' })
}

/**
 * Read one file's current collaboration state and Viewer targets.
 * @param file - absolute path of the `.univer` file.
 * @param sessionId - the session whose workspace authorizes the read.
 * @returns the file's worktrees and the Viewer targets that open them.
 */
export function getFileState(file: string, sessionId: SessionId): Promise<FileState> {
  return request(`/univer-api/state?file=${encodeURIComponent(file)}&sessionId=${encodeURIComponent(sessionId)}`)
}

/**
 * Whether a failure means the projected file is gone from the session workspace.
 * @param error - any value thrown by a browser API call.
 * @returns true when the file was removed or never successfully created.
 */
export function isMissingUniverFile(error: unknown): boolean {
  return error instanceof UniverApiError && error.code === 'INVALID_FILE_PATH'
}
