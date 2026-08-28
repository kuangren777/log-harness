/** Browser-safe Gateway process state returned by the Host API. */
export interface GatewayStatus {
  readonly phase: 'stopped' | 'starting' | 'running' | 'failed'
  readonly gateway: string | null
  readonly owned: boolean
  readonly reason?: string
}

/** Result of ensuring that the bundled Gateway is available. */
export type EnsureGatewayResult =
  | { readonly ok: true; readonly gateway: string; readonly reused: boolean }
  | { readonly ok: false; readonly reason: string }

/**
 * Gateway state as the browser may see it.
 *
 * Deliberately not {@link GatewayStatus}: that carries the loopback origin and
 * port the Gateway binds, which is host-process detail a page has no use for
 * and an attacker would use to address the service directly. `reason` is
 * withheld for the same reason — it names ports and process failures.
 */
export interface GatewayStatusView {
  readonly phase: GatewayStatus['phase']
  readonly gatewayRunning: boolean
  readonly owned: boolean
}

/** Host status visible to the DSH browser client. */
export interface UniverStatus {
  readonly gateway: GatewayStatusView
  readonly unitContent: 'bundled' | 'unavailable'
}
