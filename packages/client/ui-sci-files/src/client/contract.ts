/**
 * The files mode's data vocabulary: the plain rows, file contents, and
 * outcomes the injected face hands the components. Every member is
 * JSON-compatible — the wire types stay behind `apply`, so a change to
 * `workspace.listDirectory`, `workspace.readFile`, or `/univer-api/state` is
 * absorbed by one adapter instead of reaching presentation code.
 */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SciFilesStoreInstance } from './stores.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The outward face only; the mode's own state stays inside this plugin. */
    sciFiles: ISciFiles
  }
}

/**
 * Cross-plugin locate face (`ctx.sciFiles`): the one gesture another plugin
 * has for the files mode. The sci conversation's artifact chips are its
 * consumer — a chip names a path the turn produced and hands it here rather
 * than reaching for this package's store or its slot entry.
 */
export interface ISciFiles {
  /**
   * Pin one workspace path in the files mode and bring the mode forward. The
   * pin outranks auto-locate exactly as a tree click does, so a later
   * delivery still locates itself.
   * @param path - absolute or session-cwd-relative file path.
   */
  locate(path: string): void
}

/**
 * The panel transition the mode's header drives. Narrower than `ILayout` on
 * purpose: the header owns one gesture and a test double owes nothing more.
 */
export interface SciFilesLayout {
  /** Close the details column. */
  closeDetails: () => void
}

/** One row of a listed directory level. */
export interface SciFileEntry {
  /** Base name shown in the tree row, leading dot included. */
  readonly name: string
  /** Absolute path in the filesystem world the session's tools run in. */
  readonly path: string
  /**
   * Whether the row expands (directory), previews (file), or only shows
   * (`other`: a socket, device, or dangling symlink, which has no bytes to
   * read and no level to list).
   */
  readonly kind: 'directory' | 'file' | 'other'
}

/** Why a level produced no rows; every arm has its own tree copy. */
export type DirectoryErrorCode =
  | 'path-out-of-scope'
  | 'file-not-found'
  | 'not-a-directory'
  | 'too-many-entries'
  | 'session-not-found'
  | 'cancelled'
  | 'internal'

/**
 * One complete directory level, or the reason there is none. Never partial:
 * a level past the deployment's entry cap fails with `too-many-entries`
 * rather than arriving cut.
 */
export type DirectoryOutcome =
  | { readonly ok: true; readonly entries: readonly SciFileEntry[] }
  | { readonly ok: false; readonly code: DirectoryErrorCode }

/** One file's complete content as the preview consumes it. */
export interface SciFileContent {
  /** Canonical path the backend read (not the requested spelling). */
  readonly path: string
  /** Byte length before `encoding` is applied. */
  readonly size: number
  /** Media type the backend derived from the extension. */
  readonly mediaType: string
  /** How `content` carries the bytes. */
  readonly encoding: 'utf8' | 'base64'
  /** The complete file content in `encoding`. */
  readonly content: string
}

/** Why a read produced no content; every arm has its own preview copy. */
export type FileReadErrorCode =
  | 'file-not-found'
  | 'not-a-file'
  | 'file-too-large'
  | 'path-out-of-scope'
  | 'session-not-found'
  | 'cancelled'
  | 'internal'

/** One file read's outcome. */
export type FileReadOutcome =
  | { readonly ok: true; readonly file: SciFileContent }
  | { readonly ok: false; readonly code: FileReadErrorCode }

/** The office runtime's answer for one document, or the fact that it did not answer. */
export type OfficeStateOutcome =
  | {
    readonly ok: true
    /** Same-origin Viewer target, or null when the runtime has none for this file. */
    readonly viewerUrl: string | null
    /** Whether the collaboration Gateway is up; false means the frame is read-only. */
    readonly gatewayRunning: boolean
  }
  | { readonly ok: false }

/**
 * What the mode's entry receives from this plugin's apply closure: the wire
 * callbacks, the panel transitions its header drives, and the mode's own
 * store instance.
 *
 * The store is created in `apply` rather than declared at the registration
 * seat because `ctx.sciFiles.locate` writes to it before anything renders —
 * a locate that arrives with the details column closed must land the pin and
 * only then open the column.
 */
export interface SciFilesInjected {
  /** Shared viewing state of the mode (pin and open directories). */
  files: SciFilesStoreInstance
  /** The panel transitions the mode's header drives. */
  layout: SciFilesLayout
  /**
   * List one directory level for the tree.
   * @param sessionId - session whose project directory scopes the path.
   * @param path - absolute or session-cwd-relative directory; empty is that cwd.
   * @returns the level's rows, or why it cannot be shown.
   */
  listDirectory: (sessionId: SessionId, path: string) => Promise<DirectoryOutcome>
  /**
   * Read one file's complete content for the preview.
   * @param sessionId - session whose project directory scopes the path.
   * @param path - absolute or session-cwd-relative file path.
   * @returns the content, or the reason there is none.
   */
  readFile: (sessionId: SessionId, path: string) => Promise<FileReadOutcome>
  /**
   * Read one office document's collaboration state and Viewer target.
   * @param sessionId - session whose project directory scopes the path.
   * @param path - absolute or session-cwd-relative document path.
   * @returns the Viewer target and Gateway liveness, or the failure to reach the runtime.
   */
  officeState: (sessionId: SessionId, path: string) => Promise<OfficeStateOutcome>
}
