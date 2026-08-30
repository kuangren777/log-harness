/**
 * Package-owned invariant for `@deepseek-ai/dsh-sci-library`.
 *
 * The relationship this asserts, over the `sci_library_entry` table as it
 * changes: every file a committed row names lies inside that row's own entry
 * directory, under a bare name with no path in it. Three surfaces resolve those
 * paths independently — `GET /library-api/file` joins the library root to the
 * stored name, the browser's detail page shows the same path, and the prompt
 * tells the model to open `<libraryRoot>/<entry-dir>/<name>` with `read` — so a
 * row whose file escaped its directory would leave the three disagreeing about
 * where the bytes are, and a stored `..` segment would point a read outside the
 * library entirely. `domain/changed` carries the committed row, so the check
 * runs on mutable data at its commit point rather than on registration presence.
 * @module @deepseek-ai/dsh-sci-library/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { entryFilePath } from './files.ts'
import { ENTRY_TABLE, sciLibraryDomainSpec } from './spec.ts'
import type { LibraryEntry } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-library'

/** Cordis companion plugin name. */
export const name = 'sci-library-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Assert that one committed row's files live under its own entry directory.
 * @param change - the committed domain change.
 * @param fail - the package-attributed invariant reporter.
 */
export function validateChange(change: DomainChanged, fail: InvariantFailure): void {
  if (change.domain !== sciLibraryDomainSpec.name || change.table !== ENTRY_TABLE) return
  if (change.operation !== 'put') return
  const entry = change.value as LibraryEntry
  for (const file of entry.files) {
    const expected = entryFilePath(entry.id, file.name)
    if (file.path !== expected) {
      fail(`library entry ${entry.id} stores a file at ${JSON.stringify(file.path)}, which is not under its own directory (expected ${expected})`)
    }
  }
}

/** Install validation on the authoritative domain-change stream. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change: DomainChanged) => { validateChange(change, fail) }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
