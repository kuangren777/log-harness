/**
 * Sandbox backend of the directory-picker seam: registers `ctx.directoryPicker`
 * with the `browse` capability implemented against the E2B sandbox owned by
 * `ctx.e2b`, not the host process filesystem. A deployment whose filesystem and
 * subprocess seams live in the sandbox must offer workspace directories that
 * exist THERE — a host path the operator picked is a session cwd every sandbox
 * command then fails on, because the two filesystems share nothing but their
 * spelling. The capability kind stays `browse`, so the existing browser surface
 * and RPC consumer are unchanged; only the world being listed differs.
 * @module @deepseek-ai/dsh-host-directory-picker-e2b
 */

import { posix } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FileType } from '@deepseek-ai/dsh-e2b'
import type { EntryInfo, Sandbox } from '@deepseek-ai/dsh-e2b'
import {
  DirectoryPicker, DirectoryPickerError,
} from '@deepseek-ai/dsh-host-directory-picker'
import type {
  DirectoryEntry, DirectoryListing, DirectoryPickerCapability,
} from '@deepseek-ai/dsh-host-directory-picker'

/**
 * Symbolic-link hops one listing row may cost before the row counts as not
 * enterable. Each hop is one sandbox metadata request, so the bound is what
 * keeps a link cycle (`a -> b -> a`) and a pathological chain from turning one
 * row into unbounded remote traffic. It is a traffic invariant of the remote
 * probe rather than a deployment choice: Linux itself refuses a chain past 40
 * hops, and a workspace tree needing more than this is broken, not deep.
 */
const SYMLINK_HOPS = 8

/**
 * True when the path names one fixed location in the sandbox. The sandbox is
 * Linux whatever the host runs, so POSIX-absolute is the whole condition — the
 * host's own platform rules (Windows drive qualification) never apply to a
 * remote path.
 * @param path - candidate path.
 * @returns whether the path is absolute in the sandbox.
 */
export function sandboxFullyQualified(path: string): boolean {
  return posix.isAbsolute(path)
}

/**
 * Ancestor chain from the sandbox root to `target` inclusive — the breadcrumb
 * rows of a listing, every one a jump target. `target` must be absolute, so the
 * chain always terminates at `/`, whose crumb is labeled by its full path.
 * @param target - absolute POSIX directory the listing is about.
 * @returns crumbs ordered root-first.
 */
export function sandboxAncestry(target: string): DirectoryEntry[] {
  const crumbs: DirectoryEntry[] = [{ name: '/', path: '/', hidden: false }]
  let walked = '/'
  for (const segment of target.split('/').filter(part => part !== '')) {
    walked = posix.join(walked, segment)
    crumbs.push({ name: segment, path: walked, hidden: false })
  }
  return crumbs
}

/** Request options for the E2B SDK; `exactOptionalPropertyTypes` refuses an explicit `signal: undefined`. */
function signalOpts(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal }
}

/** Validated plugin configuration. */
export interface Config {
  /** Complete-result bound of one listing level; see {@link E2BDirectoryPicker.Config}. */
  maxEntries: number
}

/** The `ctx.directoryPicker` sandbox implementation (stable capability object per service life). */
export default class E2BDirectoryPicker extends DirectoryPicker {
  /** The sandbox owner whose remote world this backend browses. */
  static inject = ['e2b']

  /* jscpd:ignore-start -- the config field, the stable capability object, and the
     capability() accessor are deliberately identical to the browse backend's: both
     serve one seam capability whose bound and stability are the seam's contract, and
     the two differ only in the filesystem their primitives reach. Extracting the
     wiring would make this package depend on the host backend it replaces. */
  /**
   * `maxEntries` bounds the complete listing level a single `list` call may put
   * on the wire: at most this many child-directory rows (hidden rows included),
   * with `truncated` flagging a cut level. The default matches the browse
   * backend's, which follows GitHub's web UI truncating directory listings at
   * 1,000 entries.
   */
  static Config: z<Config> = z.object({
    maxEntries: z.natural().min(1).default(1000),
  })

  private readonly browseCapability: DirectoryPickerCapability = {
    kind: 'browse',
    list: (path, signal) => this.list(path, signal),
    createDirectory: (path, name) => this.createDirectory(path, name),
  }

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
  }

  /**
   * The browse interaction capability, served from the sandbox.
   * @returns the stable `browse` capability object.
   */
  capability(): DirectoryPickerCapability {
    return this.browseCapability
  }
  /* jscpd:ignore-end */

  private async list(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    // The shared remote working directory is this backend's home: it is the one
    // directory the sandbox owner guarantees exists before any adapter runs.
    const home = this.ctx.e2b.cwd
    // The seam contract takes fully qualified paths only; a relative or empty
    // wire value must never be rebased against anything.
    if (path !== undefined && !sandboxFullyQualified(path)) {
      throw new DirectoryPickerError('directory-unreadable', path, `cannot list "${path}": not a fully qualified path`)
    }
    const target = posix.resolve(path ?? home)
    let sandbox: Sandbox
    let listed: EntryInfo[]
    try {
      signal?.throwIfAborted()
      // Sandbox acquisition shares the caller's failure: an unreachable
      // sandbox is a level that cannot be listed, reported with the seam's
      // vocabulary rather than as an untyped transport failure.
      sandbox = await this.ctx.e2b.getSandbox()
      listed = await sandbox.files.list(target, { depth: 1, ...signalOpts(signal) })
    } catch (error: unknown) {
      // An abort is the caller's own reason, not an unreadable directory.
      signal?.throwIfAborted()
      throw new DirectoryPickerError('directory-unreadable', target, `cannot list ${target}: ${String(error)}`)
    }
    // envd returns the whole level in one response, so the bound is applied to
    // what crosses to the client rather than to what the scan retains: the
    // name-sorted head is kept, and only windowed candidates cost a symlink
    // probe. A windowed row that turns out non-enterable is not backfilled from
    // beyond the window — the level is already flagged truncated then, which
    // stays the honest answer.
    const candidates = listed
      .filter(entry => entry.type === FileType.DIR || entry.symlinkTarget !== undefined)
      .sort((left, right) => left.name.localeCompare(right.name))
    const keep = this.config.maxEntries + 1
    const entries: DirectoryEntry[] = []
    // One candidate past the window proves the cut without any probe.
    let truncated = candidates.length > keep
    for (const candidate of candidates.slice(0, keep)) {
      // A caller that departed between probes stops before the next one.
      signal?.throwIfAborted()
      if (!await this.enterable(sandbox, candidate, signal)) continue
      if (entries.length === this.config.maxEntries) {
        truncated = true
        break
      }
      entries.push({
        name: candidate.name,
        // The sandbox is POSIX, so rows are joined here rather than by the
        // client, exactly as the seam requires.
        path: posix.join(target, candidate.name),
        hidden: candidate.name.startsWith('.'),
      })
    }
    return { path: target, home, crumbs: sandboxAncestry(target), entries, truncated }
  }

  private async createDirectory(path: string, name: string): Promise<string> {
    // Same fully-qualified fence as list.
    if (!sandboxFullyQualified(path)) {
      throw new DirectoryPickerError('directory-create-failed', path, `cannot create under "${path}": not a fully qualified parent path`)
    }
    const parent = posix.resolve(path)
    // The backend owns segment validation (the wire schema also refuses these,
    // but direct service consumers must hit the same fence). `\` is a legal
    // character in a Linux file name, so only `/` and NUL are separators here.
    if (name.trim() === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
      throw new DirectoryPickerError('directory-create-failed', posix.join(parent, name), `"${name}" is not a single path segment`)
    }
    const target = posix.join(parent, name)
    try {
      const sandbox = await this.ctx.e2b.getSandbox()
      // E2B's makeDir creates every missing level, so the parent is probed
      // first: the parent is the directory the browser is showing, and a
      // missing one is a real failure rather than a level to invent.
      const container = await sandbox.files.getInfo(parent)
      if (!await this.enterable(sandbox, container, undefined)) {
        throw new DirectoryPickerError('directory-create-failed', target, `cannot create ${target}: ${parent} is not a directory`)
      }
      // makeDir reports false for an existing path instead of failing.
      if (!await sandbox.files.makeDir(target)) {
        throw new DirectoryPickerError('directory-exists', target, `${target} already exists`)
      }
      return target
    } catch (error: unknown) {
      if (error instanceof DirectoryPickerError) throw error
      throw new DirectoryPickerError('directory-create-failed', target, `cannot create ${target}: ${String(error)}`)
    }
  }

  /**
   * Whether a listing candidate is a directory the browser can enter, following
   * symbolic links up to {@link SYMLINK_HOPS} hops. A broken or cyclic link is
   * skipped silently: the metadata probe IS the enterability test, and a link
   * whose target cannot be read cannot be entered either.
   */
  private async enterable(sandbox: Sandbox, entry: EntryInfo, signal: AbortSignal | undefined): Promise<boolean> {
    if (entry.symlinkTarget === undefined) return entry.type === FileType.DIR
    // envd reports a link's own metadata (its `type` describes the link, not
    // the target), so the chain is walked by resolving each target against the
    // link's parent — relative targets included.
    let base = posix.dirname(entry.path)
    let next = entry.symlinkTarget
    for (let hop = 0; hop < SYMLINK_HOPS; hop += 1) {
      const resolved = posix.resolve(base, next)
      let probed: EntryInfo
      try {
        probed = await sandbox.files.getInfo(resolved, signalOpts(signal))
      } catch {
        // A probe that lost to the caller's abort is the caller's outcome, not
        // a verdict about the row.
        signal?.throwIfAborted()
        return false
      }
      if (probed.symlinkTarget === undefined) return probed.type === FileType.DIR
      base = posix.dirname(resolved)
      next = probed.symlinkTarget
    }
    return false
  }
}
