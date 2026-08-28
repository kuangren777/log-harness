/**
 * Files-mode plugin, browser half: registers the Files entry of the details
 * column's mode strip and binds the three wire calls its components drive.
 *
 * All adaptation lives here — the directory rows, the read outcomes, and the
 * office runtime's answer become the plain vocabulary of `./contract.ts`, so
 * the components never see an RPC error envelope or a wire type. Composing
 * this plugin out of cordis.yml removes the tab entirely; the details column
 * falls back to its single built-in mode with no strip at all.
 */
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge declaring `conversation.details.mode`.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ctx.layout merge carrying showDetailsMode.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  DirectoryErrorCode, DirectoryOutcome, FileReadErrorCode, FileReadOutcome, OfficeStateOutcome, SciFilesInjected,
} from './contract.ts'
import { FilesMode } from './FilesMode.tsx'
import { VIEWER_PATH_PREFIX } from './office-url.ts'
import { createSciFilesStore } from './stores.ts'
import { watchProducedFiles } from './watch-produced.ts'
import { en, NS, zh, type SciFilesKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Files-mode tree, preview, and office-frame copy. */
    'sci-files': SciFilesKey
  }
}

// Export discipline: packages/client/AGENTS.md. The Loader exports are the
// whole `/client` surface; same-package tests reach the components, the store
// factory, and the derivations through their own modules.

/** Required services for the mode registration, its dictionaries, and auto-locate. */
export const inject = ['slots', 'locale', 'connection', 'layout', 'sessions']

/** This entry's id in the details column's mode strip. */
const MODE_ID = 'files'

/** The office runtime's browser API path; same origin, session-scoped by the host. */
const OFFICE_STATE_PATH = '/univer-api/state'

/** Error codes `workspace.readFile` answers with; anything else reads as an internal failure. */
const READ_ERROR_CODES: ReadonlySet<string> = new Set<FileReadErrorCode>([
  'file-not-found', 'not-a-file', 'file-too-large', 'path-out-of-scope', 'session-not-found', 'cancelled', 'internal',
])

/** Error codes `workspace.listDirectory` answers with; same fallback rule. */
const LIST_ERROR_CODES: ReadonlySet<string> = new Set<DirectoryErrorCode>([
  'path-out-of-scope', 'file-not-found', 'not-a-directory', 'too-many-entries',
  'session-not-found', 'cancelled', 'internal',
])

/**
 * The tree's code for one listing failure. A code this mode has no copy for
 * still produces a stated failure rather than a silent empty level.
 * @param code - the wire error code.
 * @returns the code, or `internal`.
 */
function statedListCode(code: string): DirectoryErrorCode {
  return LIST_ERROR_CODES.has(code) ? code as DirectoryErrorCode : 'internal'
}

/**
 * The preview's code for one read failure; same fallback rule as the tree's.
 * @param code - the wire error code.
 * @returns the code, or `internal`.
 */
function statedReadCode(code: string): FileReadErrorCode {
  return READ_ERROR_CODES.has(code) ? code as FileReadErrorCode : 'internal'
}

/**
 * One directory level as the tree consumes it. The listing is session-scoped
 * and carries the same containment fence as the read, so both surfaces agree
 * on what "inside the project" means; dotfiles arrive and the tree hides them.
 * @param api - the shared wire client.
 * @param sessionId - session whose project directory scopes the path.
 * @param path - absolute or session-cwd-relative directory.
 * @returns the level's rows, or why it cannot be shown.
 */
async function listLevel(
  api: ConnectionHandle['api'],
  sessionId: SessionId,
  path: string,
): Promise<DirectoryOutcome> {
  const response = await api.workspace.listDirectory({ sessionId, path })
  if (!response.result.ok) {
    return { ok: false, code: statedListCode(response.result.error.code) }
  }
  return {
    ok: true,
    entries: response.result.value.entries.map(entry => ({
      name: entry.name, path: entry.path, kind: entry.kind,
    })),
  }
}

/**
 * The Viewer target one runtime answer may be trusted for, or null.
 *
 * This value ends up in an `<iframe src>`, which is script execution in this
 * origin, and it arrives as untyped JSON over a route no RPC schema covers —
 * so it is a wire boundary and gets validated like one. Only a same-origin
 * relative path under the Gateway's own reverse-proxy prefix is accepted:
 * `javascript:` and `data:` parse to an opaque origin, `//host` and any
 * absolute URL to a foreign one, and `/univer-gw/../evil` normalizes out of
 * the prefix. Testing the PARSED pathname rather than the raw string is what
 * closes that last one. Anything refused leaves the panel in its
 * runtime-unavailable state instead of framing a hostile document.
 * @param value - the answer's `viewerUrl` member, unvalidated.
 * @returns the canonical relative target, or null when there is none to trust.
 */
function trustedViewerUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let target: URL
  try {
    target = new URL(value, location.origin)
  } catch {
    // Not a parsable reference even against a base; there is nothing to frame.
    return null
  }
  if (target.origin !== location.origin) return null
  if (!target.pathname.startsWith(VIEWER_PATH_PREFIX)) return null
  return `${target.pathname}${target.search}${target.hash}`
}

/**
 * One office document's collaboration state.
 *
 * The route is the office plugin's own browser API on this origin, reached
 * with `fetch` rather than the RPC carrier because that is the interface the
 * office package publishes. A deployment without the office plugin answers
 * 404, which reads the same as a Gateway that failed to start: no frame. The
 * body is untyped JSON, so both members it contributes are checked here —
 * `gatewayRunning` grants editing and `viewerUrl` becomes a frame source.
 * @param sessionId - session whose project directory scopes the path.
 * @param path - the document to open.
 * @returns the Viewer target and Gateway liveness, or the failure to reach the runtime.
 */
async function fetchOfficeState(sessionId: SessionId, path: string): Promise<OfficeStateOutcome> {
  const query = `file=${encodeURIComponent(path)}&sessionId=${encodeURIComponent(sessionId)}`
  try {
    const response = await fetch(`${OFFICE_STATE_PATH}?${query}`)
    if (!response.ok) return { ok: false }
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null) return { ok: false }
    const state = body as { viewerUrl?: unknown; gatewayRunning?: unknown }
    return {
      ok: true,
      viewerUrl: trustedViewerUrl(state.viewerUrl),
      // Strict equality, not truthiness: a non-boolean must never grant editing.
      gatewayRunning: state.gatewayRunning === true,
    }
  } catch {
    // The office runtime is not reachable (absent plugin, dropped connection,
    // a body that is not JSON); the frame states that instead of rendering an
    // empty rectangle.
    return { ok: false }
  }
}

/**
 * Client plugin body: register the dictionaries and the Files mode entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const store = createSciFilesStore()

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sci-files: dictionaries')

  // Auto-locate: a file the session just produced brings this column forward.
  // The mode then shows that file by deriving it (see FilesMode), so the two
  // halves cannot disagree about which file "the newest" is.
  ctx.effect(
    () => watchProducedFiles(ctx.sessions, () => { ctx.layout.showDetailsMode(MODE_ID) }),
    'ui-sci-files: auto-locate produced files',
  )

  const injected = (): SciFilesInjected => ({
    listDirectory: (sessionId, path) => listLevel(connection.api, sessionId, path),
    readFile: async (sessionId, path): Promise<FileReadOutcome> => {
      const response = await connection.api.workspace.readFile({ sessionId, path })
      return response.result.ok
        ? { ok: true, file: response.result.value }
        : { ok: false, code: statedReadCode(response.result.error.code) }
    },
    officeState: fetchOfficeState,
  })

  // slots.inject, not a bare register: the conversation entry declaring this
  // mode strip may activate later, and a redeclaration must re-install the tab.
  ctx.slots.inject('conversation.details.mode', () => ctx.slots.register({
    name: 'conversation.details.mode',
    id: MODE_ID,
    order: 10,
    label: () => ctx.locale.bind(NS)('files.tab'),
    locale: NS,
    store,
    inject: injected,
  }, FilesMode))
}
