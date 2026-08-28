/** Behavior of the sandbox directory-picker backend against a fake E2B remote. */

import { posix } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FileNotFoundError, FileType } from '@deepseek-ai/dsh-e2b'
import type { EntryInfo, Sandbox } from '@deepseek-ai/dsh-e2b'
import type { E2BRuntime } from '@deepseek-ai/dsh-e2b'
import { DirectoryPickerError } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerBrowseCapability } from '@deepseek-ai/dsh-host-directory-picker'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import E2BDirectoryPicker, { sandboxAncestry, sandboxFullyQualified } from '@deepseek-ai/dsh-host-directory-picker-e2b'
import type { Config } from '@deepseek-ai/dsh-host-directory-picker-e2b'
import * as E2BPickerInvariant from '../src/invariant.ts'

const SANDBOX_CWD = '/home/user/sci'

interface RemoteNode {
  type: FileType
  symlinkTarget?: string
}

/** Minimal E2B remote: a path-keyed node map behind the file API this backend uses. */
class FakeRemote {
  readonly nodes = new Map<string, RemoteNode>()
  readonly listed: string[] = []
  readonly probed: string[] = []
  readonly created: string[] = []

  /** Rejection the next `list` raises instead of answering. */
  nextListError: unknown
  /** Rejection the next `getInfo` raises instead of answering. */
  nextInfoError: unknown
  /** Rejection the next `makeDir` raises instead of answering. */
  nextMakeDirError: unknown
  /** Rejection `getSandbox` raises instead of handing back the remote. */
  acquisitionError: unknown
  /** Aborted by `getInfo` before it rejects, to land an abort inside a probe. */
  abortOnInfo: AbortController | undefined

  constructor() {
    this.dir('/')
    this.dir('/home')
    this.dir('/home/user')
    this.dir(SANDBOX_CWD)
  }

  dir(path: string): void {
    this.nodes.set(path, { type: FileType.DIR })
  }

  file(path: string): void {
    this.nodes.set(path, { type: FileType.FILE })
  }

  /** A symlink as envd reports it: the link's own entry, carrying its target. */
  symlink(path: string, target: string): void {
    this.nodes.set(path, { type: FileType.FILE, symlinkTarget: target })
  }

  private info(path: string): EntryInfo {
    const node = this.nodes.get(path)
    if (node === undefined) throw new FileNotFoundError(`missing: ${path}`)
    return {
      name: posix.basename(path),
      path,
      type: node.type,
      size: 0,
      mode: 0o755,
      permissions: 'rwxr-xr-x',
      owner: 'user',
      group: 'user',
      ...(node.symlinkTarget !== undefined ? { symlinkTarget: node.symlinkTarget } : {}),
    }
  }

  readonly sandbox = {
    sandboxId: 'fake',
    files: {
      list: async (path: string, options?: { depth?: number; signal?: AbortSignal }): Promise<EntryInfo[]> => {
        this.listed.push(path)
        expect(options?.depth).toBe(1)
        if (this.nextListError !== undefined) {
          const error = this.nextListError
          this.nextListError = undefined
          throw error
        }
        if (!this.nodes.has(path)) throw new FileNotFoundError(`missing: ${path}`)
        return [...this.nodes.keys()]
          .filter(candidate => candidate !== path && posix.dirname(candidate) === path)
          .map(candidate => this.info(candidate))
      },
      getInfo: async (path: string): Promise<EntryInfo> => {
        this.probed.push(path)
        this.abortOnInfo?.abort(new Error('caller left'))
        if (this.nextInfoError !== undefined) {
          const error = this.nextInfoError
          this.nextInfoError = undefined
          throw error
        }
        return this.info(path)
      },
      makeDir: async (path: string): Promise<boolean> => {
        if (this.nextMakeDirError !== undefined) {
          const error = this.nextMakeDirError
          this.nextMakeDirError = undefined
          throw error
        }
        if (this.nodes.has(path)) return false
        this.created.push(path)
        this.dir(path)
        return true
      },
    },
  } as unknown as Sandbox
}

async function setup(
  remote = new FakeRemote(),
  config?: Config,
): Promise<{
  ctx: Context
  capability: DirectoryPickerBrowseCapability
  remote: FakeRemote
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const runtime = {
    cwd: SANDBOX_CWD,
    runtimeRoot: posix.join(SANDBOX_CWD, '.dsh-e2b'),
    getSandbox: async () => {
      if (remote.acquisitionError !== undefined) throw remote.acquisitionError
      return remote.sandbox
    },
  } as unknown as E2BRuntime
  ctx.provide('e2b', runtime)
  const fiber = ctx.plugin(E2BDirectoryPicker, config)
  await fiber.await()
  const picked = ctx.get('directoryPicker')!.capability()
  if (picked.kind !== 'browse') throw new Error('sandbox backend must advertise the browse capability')
  return { ctx, capability: picked, remote, dispose: () => fiber.dispose() }
}

async function failure(promise: Promise<unknown>): Promise<DirectoryPickerError> {
  const caught = await promise.catch((error: unknown) => error)
  expect(caught).toBeInstanceOf(DirectoryPickerError)
  return caught as DirectoryPickerError
}

describe('E2BDirectoryPicker listing', () => {
  it('resolves home to ctx.e2b.cwd and lists that level when no path is given', async () => {
    const remote = new FakeRemote()
    remote.dir(`${SANDBOX_CWD}/projects`)
    const { ctx, capability, dispose } = await setup(remote)
    const listing = await capability.list()
    expect(listing.path).toBe(SANDBOX_CWD)
    expect(listing.home).toBe(SANDBOX_CWD)
    expect(remote.listed).toEqual([SANDBOX_CWD])
    expect(listing.entries.map(entry => entry.name)).toEqual(['projects'])
    // Disposal removes the seam registration (HMR safety).
    await dispose()
    expect(ctx.get('directoryPicker')).toBeUndefined()
  })

  it('lists directories only, flags hidden rows, follows link chains, skips the rest, sorts by name', async () => {
    const remote = new FakeRemote()
    remote.dir(`${SANDBOX_CWD}/projects`)
    remote.dir(`${SANDBOX_CWD}/.hidden-dir`)
    remote.file(`${SANDBOX_CWD}/notes.txt`)
    // Absolute link to a directory, relative link to a directory, one hop
    // through another link, a link to a file, and a broken link.
    remote.symlink(`${SANDBOX_CWD}/linked`, `${SANDBOX_CWD}/projects`)
    remote.symlink(`${SANDBOX_CWD}/relative`, 'projects')
    remote.symlink(`${SANDBOX_CWD}/chained`, 'linked')
    remote.symlink(`${SANDBOX_CWD}/file-link`, 'notes.txt')
    remote.symlink(`${SANDBOX_CWD}/broken`, 'gone')
    const { capability, dispose } = await setup(remote)
    try {
      const listing = await capability.list(SANDBOX_CWD)
      expect(listing.entries.map(entry => entry.name)).toEqual([
        '.hidden-dir', 'chained', 'linked', 'projects', 'relative',
      ])
      expect(listing.entries.map(entry => entry.hidden)).toEqual([true, false, false, false, false])
      expect(listing.entries.every(entry => entry.path === posix.join(SANDBOX_CWD, entry.name))).toBe(true)
      expect(listing.truncated).toBe(false)
    } finally {
      await dispose()
    }
  })

  it('gives up on a link cycle after the hop bound instead of probing forever', async () => {
    const remote = new FakeRemote()
    remote.symlink(`${SANDBOX_CWD}/a`, 'b')
    remote.symlink(`${SANDBOX_CWD}/b`, 'a')
    const { capability, dispose } = await setup(remote)
    try {
      const listing = await capability.list(SANDBOX_CWD)
      expect(listing.entries).toEqual([])
      // Two rows, each costing exactly the hop bound and no more.
      expect(remote.probed).toHaveLength(16)
    } finally {
      await dispose()
    }
  })

  it('cuts a level at maxEntries keeping the name-sorted head, and flags the cut', async () => {
    const remote = new FakeRemote()
    remote.dir(`${SANDBOX_CWD}/a`)
    remote.dir(`${SANDBOX_CWD}/b`)
    const { capability, dispose } = await setup(remote, { maxEntries: 1 })
    try {
      const cut = await capability.list(SANDBOX_CWD)
      expect(cut.entries.map(entry => entry.name)).toEqual(['a'])
      expect(cut.truncated).toBe(true)
      // Exactly at the bound is complete, not truncated.
      const exact = await capability.list(`${SANDBOX_CWD}/a`)
      expect(exact.entries).toEqual([])
      expect(exact.truncated).toBe(false)
      // A third row puts a candidate past the window, which proves the cut
      // before any probe runs.
      remote.dir(`${SANDBOX_CWD}/c`)
      const beyondWindow = await capability.list(SANDBOX_CWD)
      expect(beyondWindow.entries.map(entry => entry.name)).toEqual(['a'])
      expect(beyondWindow.truncated).toBe(true)
    } finally {
      await dispose()
    }
  })

  it('reports the ancestry as jump-target crumbs ending at the listed directory', async () => {
    const { capability, dispose } = await setup()
    try {
      const listing = await capability.list(SANDBOX_CWD)
      expect(listing.crumbs).toEqual([
        { name: '/', path: '/', hidden: false },
        { name: 'home', path: '/home', hidden: false },
        { name: 'user', path: '/home/user', hidden: false },
        { name: 'sci', path: SANDBOX_CWD, hidden: false },
      ])
      const root = await capability.list('/')
      expect(root.crumbs).toEqual([{ name: '/', path: '/', hidden: false }])
    } finally {
      await dispose()
    }
  })

  it('classifies fully qualified sandbox paths by POSIX rules only', () => {
    expect(sandboxFullyQualified('/home/user/sci')).toBe(true)
    expect(sandboxFullyQualified('sci')).toBe(false)
    expect(sandboxFullyQualified('')).toBe(false)
    // A Windows-shaped path is a relative name in a Linux sandbox, never a root.
    expect(sandboxFullyQualified('C:\\projects')).toBe(false)
    expect(sandboxAncestry('/').map(crumb => crumb.path)).toEqual(['/'])
  })

  it('rejects a path that is not fully qualified instead of rebasing it', async () => {
    const { capability, remote, dispose } = await setup()
    try {
      for (const relative of ['', 'projects', './projects', '..', 'C:\\projects']) {
        const listFailure = await failure(capability.list(relative))
        expect(listFailure.code).toBe('directory-unreadable')
        expect(listFailure.path).toBe(relative)
        const createFailure = await failure(capability.createDirectory(relative, 'child'))
        expect(createFailure.code).toBe('directory-create-failed')
        expect(createFailure.path).toBe(relative)
      }
      // Nothing reached the sandbox.
      expect(remote.listed).toEqual([])
      expect(remote.created).toEqual([])
    } finally {
      await dispose()
    }
  })

  it('maps a missing directory, a permission failure, and an unreachable sandbox to directory-unreadable', async () => {
    const remote = new FakeRemote()
    const { capability, dispose } = await setup(remote)
    try {
      const missing = await failure(capability.list(`${SANDBOX_CWD}/no-such-dir`))
      expect(missing.code).toBe('directory-unreadable')
      expect(missing.path).toBe(`${SANDBOX_CWD}/no-such-dir`)
      remote.nextListError = new Error('permission denied')
      const denied = await failure(capability.list(SANDBOX_CWD))
      expect(denied.code).toBe('directory-unreadable')
      expect(denied.message).toContain('permission denied')
      remote.acquisitionError = new Error('dsh-dormice: sandbox service is disposing')
      const unreachable = await failure(capability.list(SANDBOX_CWD))
      expect(unreachable.code).toBe('directory-unreadable')
      expect(unreachable.message).toContain('sandbox service is disposing')
    } finally {
      await dispose()
    }
  })

  it('stops with the caller: an abort before or inside a probe rejects with the abort reason', async () => {
    const remote = new FakeRemote()
    remote.dir(`${SANDBOX_CWD}/projects`)
    remote.symlink(`${SANDBOX_CWD}/linked`, 'projects')
    const { capability, dispose } = await setup(remote)
    try {
      const gone = new AbortController()
      gone.abort(new Error('caller left'))
      await expect(capability.list(SANDBOX_CWD, gone.signal)).rejects.toThrow('caller left')
      // Nothing was requested: the abort wins before acquisition.
      expect(remote.listed).toEqual([])
      // An abort landing inside a symlink probe is the caller's outcome, not a
      // verdict that the row is unenterable.
      const midProbe = new AbortController()
      remote.abortOnInfo = midProbe
      remote.nextInfoError = new Error('request aborted')
      await expect(capability.list(SANDBOX_CWD, midProbe.signal)).rejects.toThrow('caller left')
      // A live signal changes nothing about a complete listing.
      remote.abortOnInfo = undefined
      const live = new AbortController()
      const complete = await capability.list(SANDBOX_CWD, live.signal)
      expect(complete.entries.map(entry => entry.name)).toEqual(['linked', 'projects'])
    } finally {
      await dispose()
    }
  })
})

describe('E2BDirectoryPicker creation', () => {
  it('creates one child directory under a real parent and surfaces it in the next listing', async () => {
    const remote = new FakeRemote()
    const { capability, dispose } = await setup(remote)
    try {
      const created = await capability.createDirectory(SANDBOX_CWD, 'fresh')
      expect(created).toBe(`${SANDBOX_CWD}/fresh`)
      expect(remote.created).toEqual([`${SANDBOX_CWD}/fresh`])
      const listing = await capability.list(SANDBOX_CWD)
      expect(listing.entries.map(entry => entry.name)).toEqual(['fresh'])
      // A symlinked parent is a directory the browser listed, so it creates too.
      remote.symlink(`${SANDBOX_CWD}/linked`, 'fresh')
      await expect(capability.createDirectory(`${SANDBOX_CWD}/linked`, 'deep'))
        .resolves.toBe(`${SANDBOX_CWD}/linked/deep`)
    } finally {
      await dispose()
    }
  })

  it('refuses an existing child with directory-exists', async () => {
    const remote = new FakeRemote()
    remote.dir(`${SANDBOX_CWD}/projects`)
    const { capability, dispose } = await setup(remote)
    try {
      const existing = await failure(capability.createDirectory(SANDBOX_CWD, 'projects'))
      expect(existing.code).toBe('directory-exists')
      expect(existing.path).toBe(`${SANDBOX_CWD}/projects`)
    } finally {
      await dispose()
    }
  })

  it('refuses non-segment names, a missing or non-directory parent, and remote failures', async () => {
    const remote = new FakeRemote()
    remote.file(`${SANDBOX_CWD}/notes.txt`)
    const { capability, dispose } = await setup(remote)
    try {
      for (const name of ['', '  ', '.', '..', 'a/b', 'a\0b']) {
        const rejected = await failure(capability.createDirectory(SANDBOX_CWD, name))
        expect(rejected.code).toBe('directory-create-failed')
      }
      // A backslash IS a legal Linux file name character, unlike on the host.
      await expect(capability.createDirectory(SANDBOX_CWD, 'a\\b'))
        .resolves.toBe(`${SANDBOX_CWD}/a\\b`)
      // Missing parent: a level to fail on, not one to invent.
      const missingParent = await failure(capability.createDirectory(`${SANDBOX_CWD}/no-such-dir`, 'child'))
      expect(missingParent.code).toBe('directory-create-failed')
      expect(remote.created).toEqual([`${SANDBOX_CWD}/a\\b`])
      const fileParent = await failure(capability.createDirectory(`${SANDBOX_CWD}/notes.txt`, 'child'))
      expect(fileParent.code).toBe('directory-create-failed')
      expect(fileParent.message).toContain('is not a directory')
      remote.nextMakeDirError = new Error('read-only file system')
      const readOnly = await failure(capability.createDirectory(SANDBOX_CWD, 'blocked'))
      expect(readOnly.code).toBe('directory-create-failed')
      expect(readOnly.message).toContain('read-only file system')
    } finally {
      await dispose()
    }
  })
})

describe('E2BDirectoryPicker registration', () => {
  it('registers the package-owned empty invariant installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(E2BPickerInvariant).await()
    await fiber.dispose()
  })
})
