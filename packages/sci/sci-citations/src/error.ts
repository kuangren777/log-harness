/**
 * The one error class this layer raises, and the codes it routes on.
 *
 * Every failure here is the user's or the model's — an unknown project, a
 * citekey that resolves to nothing, a pool at its limit — so the message is
 * written to be read by whoever caused it. None of them names a host, a
 * transport, or an internal path.
 * @module @deepseek-ai/dsh-sci-citations/src/error
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** A citation-pool request that could not be served, carrying a routable code. */
export class CitationsError extends HarnessError {}

/** No project slug was given and none could be inferred from the session. */
export const CITATIONS_NO_PROJECT = 'CITATIONS_NO_PROJECT'

/** The named project has no directory under `projectRoot`. */
export const CITATIONS_UNKNOWN_PROJECT = 'CITATIONS_UNKNOWN_PROJECT'

/** The named citekey is not in this project's pool. */
export const CITATIONS_UNKNOWN_CITEKEY = 'CITATIONS_UNKNOWN_CITEKEY'

/** The named group does not exist and is not one of the reserved keys. */
export const CITATIONS_UNKNOWN_GROUP = 'CITATIONS_UNKNOWN_GROUP'

/** `add` was given no identifier any lookup could resolve. */
export const CITATIONS_UNRESOLVED = 'CITATIONS_UNRESOLVED'

/** The project's pool already holds `maxCitations` entries. */
export const CITATIONS_POOL_FULL = 'CITATIONS_POOL_FULL'

/** The request was malformed before anything was read or written. */
export const CITATIONS_INVALID_REQUEST = 'CITATIONS_INVALID_REQUEST'
