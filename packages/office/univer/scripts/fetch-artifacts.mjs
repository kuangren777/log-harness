#!/usr/bin/env node
/**
 * Fetch the prebuilt Univer runtime into `artifacts/`.
 *
 * This package vendors upstream's host/client/shared SOURCE but takes the
 * Gateway, Viewer, render machine, and content worker as the BYTES upstream
 * published, because building them needs the Univer insider toolchain and a
 * browser. The tarball is pinned by version and verified against its registry
 * integrity hash before anything is extracted, so a compromised or moved
 * release fails loudly instead of landing 143 MB of unreviewed executables.
 *
 * Idempotent: a matching `artifacts/.version` short-circuits the download.
 * Re-run with `--force` to refetch.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Upstream release whose artifacts match the vendored sources. */
const PACKAGE = 'dsh-univer-office'
/** Pinned release; bump together with the sources and the upgrade log. */
const VERSION = '0.2.10'
/** Registry `dist.integrity` for {@link PACKAGE}@{@link VERSION}. */
const INTEGRITY = 'sha512-drpBS6irjbyUq8MKyr/ya/G1pSLVnVTyExtaeJI0yOsP0NVJkubZyPaPxAAFF2k18s41yEIrYjcl4j/PXjDMsg=='

/** Artifact entries extracted from the tarball, relative to its `package/` root. */
const ARTIFACTS = ['gateway.cjs', 'unit-content-worker.mjs', 'render-machine', 'viewer']

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARTIFACTS_ROOT = join(PACKAGE_ROOT, 'artifacts')
const STAMP = join(ARTIFACTS_ROOT, '.version')

/**
 * Whether `artifacts/` already holds the pinned release in full.
 * @returns true when the stamp matches and every expected entry exists.
 */
async function isCurrent() {
  if (!existsSync(STAMP)) return false
  const stamped = (await readFile(STAMP, 'utf8')).trim()
  if (stamped !== VERSION) return false
  return ARTIFACTS.every((entry) => existsSync(join(ARTIFACTS_ROOT, entry)))
}

/**
 * Verify a tarball against the pinned Subresource-Integrity string.
 * @param tarball - absolute path to the downloaded `.tgz`.
 * @throws {Error} when the digest does not match {@link INTEGRITY}.
 */
async function verifyIntegrity(tarball) {
  const [algorithm, expected] = INTEGRITY.split('-', 2)
  const actual = createHash(algorithm).update(await readFile(tarball)).digest('base64')
  if (actual !== expected) {
    throw new Error(
      `fetch-artifacts: ${PACKAGE}@${VERSION} integrity mismatch\n`
      + `  expected ${algorithm}-${expected}\n`
      + `  actual   ${algorithm}-${actual}`,
    )
  }
}

/**
 * Download, verify, and extract the pinned artifacts.
 * @returns nothing; `artifacts/` holds the pinned release when this resolves.
 */
async function main() {
  const force = process.argv.includes('--force')
  if (!force && await isCurrent()) {
    console.log(`fetch-artifacts: artifacts/ already at ${PACKAGE}@${VERSION}`)
    return
  }

  const staging = await mkdtemp(join(tmpdir(), 'dsh-office-univer-artifacts-'))
  try {
    const { stdout } = await run('npm', ['pack', `${PACKAGE}@${VERSION}`, '--pack-destination', staging], {
      cwd: staging,
      maxBuffer: 1024 * 1024 * 64,
    })
    const tarball = join(staging, stdout.trim().split('\n').at(-1))
    await verifyIntegrity(tarball)

    const extracted = join(staging, 'extracted')
    await mkdir(extracted, { recursive: true })
    await run('tar', ['-xzf', tarball, '-C', extracted], { maxBuffer: 1024 * 1024 * 64 })

    await rm(ARTIFACTS_ROOT, { recursive: true, force: true })
    await mkdir(ARTIFACTS_ROOT, { recursive: true })
    for (const entry of ARTIFACTS) {
      const source = join(extracted, 'package', 'artifacts', entry)
      if (!existsSync(source)) throw new Error(`fetch-artifacts: ${PACKAGE}@${VERSION} has no artifacts/${entry}`)
      await run('cp', ['-R', source, join(ARTIFACTS_ROOT, entry)], { maxBuffer: 1024 * 1024 * 64 })
    }
    // Written last: a stamp is only meaningful once every entry is on disk, so
    // an interrupted fetch leaves no stamp and the next run redoes the work.
    await writeFile(STAMP, `${VERSION}\n`)
    console.log(`fetch-artifacts: extracted ${PACKAGE}@${VERSION} into artifacts/`)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

// The Gateway's native dependencies (libsql and the @univerjs-pro bindings) are
// declared runtime dependencies of this package, so the package manager
// materializes them under node_modules and the spawned processes reach them
// through PLUGIN_NODE_MODULES. Upstream's copy-gateway-dependencies.mjs exists
// only to stage those packages beside a standalone build; nothing to port.

await main()
