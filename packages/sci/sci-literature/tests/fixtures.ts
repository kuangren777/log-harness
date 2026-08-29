/** Loader for the four recorded index replies every adapter test reads. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Read one recorded reply from `tests/fixtures/`.
 *
 * The four files are real replies captured from the live indexes for the query
 * `n-type SnSe thermoelectric`, trimmed to four or five entries and otherwise
 * unedited, so a field the mapper reads is a field the wire actually carries.
 * @param name - the fixture file name.
 * @returns the file text.
 */
export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
}

/**
 * Read and parse one recorded JSON reply.
 * @param name - the fixture file name.
 * @returns the parsed reply.
 */
export function jsonFixture(name: string): unknown {
  return JSON.parse(fixture(name)) as unknown
}
