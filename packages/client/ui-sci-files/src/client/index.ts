/**
 * Files-mode plugin, browser half: registers the Files entry of the details
 * column's mode strip, shadows that column's `tool` body with the sci
 * reading, publishes `ctx.sciFiles`, and binds the three wire calls the
 * components drive.
 *
 * All adaptation lives here — the directory rows and the read outcomes become
 * the plain vocabulary of `./contract.ts` (the office runtime's answer, which
 * carries its own retry, in `./office-state.ts`), so the components never see
 * an RPC error envelope or a wire type. Composing this plugin out of
 * cordis.yml removes the tab entirely, returns the built-in card-aware `tool`
 * body, and withdraws the locate service; the details column falls back to
 * its single built-in mode with no strip at all.
 */
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge declaring `conversation.details.mode`.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ctx.layout merge carrying showDetailsMode.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  DirectoryErrorCode, DirectoryOutcome, FileReadErrorCode, FileReadOutcome, ISciFiles, SciFilesInjected,
} from './contract.ts'
import { FilesMode } from './FilesMode.tsx'
import { SciToolDetails } from './SciToolDetails.tsx'
import { createOfficeStateReader, SCOPE_ATTACH_RETRY_DELAYS_MS } from './office-state.ts'
import { createSciFilesStore } from './stores.ts'
import { currentProducedPath, watchProducedFiles } from './watch-produced.ts'
import { en, NS, zh, type SciFilesKey } from './locales.ts'

export type { ISciFiles } from './contract.ts'
export { allLocatedPaths, locatedPath } from './auto-locate.ts'
export { toolDisplayName } from './tool-names.ts'

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
 * Client plugin body: register the dictionaries and the Files mode entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  // One instance for the whole plugin body, not a seat declaration: locate()
  // writes the pin before the details column has ever rendered, and a store
  // the framework instantiates at first render would drop that write.
  const files = createSciFilesStore().create()
  // One reader per plugin body: the frame's read effect depends on this
  // identity, so a per-call reader would re-query on every render.
  const officeState = createOfficeStateReader(SCOPE_ATTACH_RETRY_DELAYS_MS)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sci-files: dictionaries')

  const sciFiles: ISciFiles = {
    locate: (path) => {
      // Recorded against what the session has produced right now, exactly as
      // a tree click is: the chip the user clicked outranks auto-locate until
      // the session delivers something newer.
      files.actions.pin(path, currentProducedPath(ctx.sessions) ?? null)
      ctx.layout.showDetailsMode(MODE_ID)
    },
  }
  ctx.effect(() => ctx.reflect.provide('sciFiles', sciFiles), 'ui-sci-files: locate service')

  // Auto-locate: a file the session just produced brings this column forward.
  // The mode then shows that file by deriving it (see FilesMode), so the two
  // halves cannot disagree about which file "the newest" is.
  ctx.effect(
    () => watchProducedFiles(ctx.sessions, () => { ctx.layout.showDetailsMode(MODE_ID) }),
    'ui-sci-files: auto-locate produced files',
  )

  const injected = (): SciFilesInjected => ({
    files,
    layout: {
      toggleDetailsWide: () => { ctx.layout.toggleDetailsWide() },
      closeDetails: () => { ctx.layout.closeDetails() },
    },
    listDirectory: (sessionId, path) => listLevel(connection.api, sessionId, path),
    readFile: async (sessionId, path): Promise<FileReadOutcome> => {
      const response = await connection.api.workspace.readFile({ sessionId, path })
      return response.result.ok
        ? { ok: true, file: response.result.value }
        : { ok: false, code: statedReadCode(response.result.error.code) }
    },
    officeState,
  })

  // slots.inject, not a bare register: the conversation entry declaring this
  // mode strip may activate later, and a redeclaration must re-install the tab.
  ctx.slots.inject('conversation.details.mode', () => ctx.slots.register({
    name: 'conversation.details.mode',
    id: MODE_ID,
    order: 10,
    label: () => ctx.locale.bind(NS)('files.tab'),
    locale: NS,
    inject: injected,
  }, FilesMode))

  // Shadowing, not sharing: the `tool` mode's body is a single seat, and a
  // lower priority than the built-in registration's default takes it. Leaving
  // this plugin out of the composition returns the built-in card-aware body.
  ctx.slots.inject('conversation.details.tool', () => ctx.slots.register({
    name: 'conversation.details.tool',
    priority: -10,
    locale: NS,
  }, SciToolDetails))
}
