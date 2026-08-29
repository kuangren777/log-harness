/**
 * The sci-gate identity reads this shell shows. Every wire shape is absorbed
 * here: the components see a total, JSON-plain vocabulary, and a gate that is
 * unreachable, unauthenticated, or answering something unexpected all arrive
 * as the same `null` rather than as an exception at render time.
 *
 * The reads are cookie-authenticated against the same origin the dsh page is
 * served from (sci-gate reverse-proxies the harness), so no credential ever
 * reaches this module.
 */

/** One VM row of the signed-in tenant, as the popover shows it. */
export interface GateVm {
  /** Stable gate-side VM id; the popover matches the selection on this, never on the slug. */
  readonly id: string
  /** Human-facing VM name. */
  readonly slug: string
  /** Lifecycle word the gate reports (`running`, `stopped`, …). */
  readonly status: string
  /** Image tag the VM currently runs. */
  readonly image_tag: string
}

/** Who the browser is signed in as, and which VM the session points at. */
export interface GateMe {
  /** Account email. */
  readonly email: string
  /** Gate role word (`admin`, `member`, …). */
  readonly role: string
  /** Tenant display name, or null for an account with no tenant of its own. */
  readonly tenant: string | null
  /** Every VM the tenant owns. */
  readonly vms: readonly GateVm[]
  /** Id of the VM this session selected, or null when none is selected. */
  readonly selectedVm: string | null
}

/** The tenant's spendable balance, in the gate's own USD strings. */
export interface GateBalance {
  /** Plan grant plus purchased credit. */
  readonly totalUsd: string
  /** Plan grant remaining this period. */
  readonly planUsd: string
  /** Purchased credit remaining. */
  readonly creditUsd: string
  /** True once both pools are spent; the gate fences the next call. */
  readonly exhausted: boolean
}

/** Identity read; the gate answers it from the session cookie alone. */
const ME_URL = '/gate/api/me'
/** Balance read; same cookie, tenant-scoped by the gate. */
const BALANCE_URL = '/gate/api/credit/balance'
/** Session teardown; the gate clears the cookie. */
const LOGOUT_URL = '/gate/api/logout'

/**
 * One cookie-authenticated GET, reduced to its parsed body or nothing. A
 * rejected status and a transport failure are the same answer here: the
 * popover has no identity to show either way.
 * @param f - fetch implementation (injected in tests).
 * @param url - same-origin gate path.
 * @returns the parsed JSON body, or null.
 */
async function readJson(f: typeof fetch, url: string): Promise<unknown> {
  try {
    const response = await f(url, { credentials: 'same-origin' })
    return response.ok ? await response.json() as unknown : null
  } catch {
    return null
  }
}

/**
 * A string field as the popover consumes it.
 * @param value - the raw field.
 * @returns the string, or an empty one.
 */
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * A gate id as a stable string, whatever the backing column's type is.
 * @param value - the raw id field.
 * @returns the id, or null when the field carries no id at all.
 */
function idOf(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

/**
 * One VM row, or nothing when the row carries no id to match a selection on.
 * @param raw - one element of the gate's `vms` array.
 * @returns the row, or null.
 */
function vmOf(raw: unknown): GateVm | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  const id = idOf(row['id'])
  if (id === null) return null
  return { id, slug: text(row['slug']), status: text(row['status']), image_tag: text(row['image_tag']) }
}

/**
 * Read who the browser is signed in as.
 * @param f - fetch implementation (injected in tests).
 * @returns the account, or null when the gate did not answer with one.
 */
export async function fetchMe(f: typeof fetch = fetch): Promise<GateMe | null> {
  const body = await readJson(f, ME_URL)
  if (typeof body !== 'object' || body === null) return null
  const row = body as Record<string, unknown>
  const vms = Array.isArray(row['vms']) ? row['vms'] : []
  return {
    email: text(row['email']),
    role: text(row['role']),
    tenant: typeof row['tenant'] === 'string' ? row['tenant'] : null,
    vms: vms.map(vmOf).filter((vm): vm is GateVm => vm !== null),
    selectedVm: idOf(row['selectedVm']),
  }
}

/**
 * Read the tenant's spendable balance.
 * @param f - fetch implementation (injected in tests).
 * @returns the balance, or null when the gate reports none (an admin cookie
 * has no tenant, and an unreachable gate has no answer).
 */
export async function fetchBalance(f: typeof fetch = fetch): Promise<GateBalance | null> {
  const body = await readJson(f, BALANCE_URL)
  if (typeof body !== 'object' || body === null) return null
  const row = body as Record<string, unknown>
  return {
    totalUsd: text(row['totalUsd']),
    planUsd: text(row['planUsd']),
    creditUsd: text(row['creditUsd']),
    exhausted: row['exhausted'] === true,
  }
}

/**
 * Clear the gate session cookie.
 * @param f - fetch implementation (injected in tests).
 * @returns true once the gate accepted the teardown; the caller navigates only then.
 */
export async function logout(f: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await f(LOGOUT_URL, { method: 'POST', credentials: 'same-origin' })
    return response.ok
  } catch {
    return false
  }
}
