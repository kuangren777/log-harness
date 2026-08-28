import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { EnsureGatewayResult } from '../../../shared/wire/status.ts'
import { GATEWAY_PORT_IN_USE_EXIT_CODE } from '../../../shared/gateway-process-protocol.ts'
import { gatewayLaunch } from './launcher.ts'
import { gatewayIsHealthy } from './protocol.ts'

type GatewayProcessStartResult = Extract<EnsureGatewayResult, { readonly ok: true }> | {
  readonly ok: false
  readonly reason: string
  readonly portInUse: boolean
}

/**
 * Whether the child has already left the process table.
 *
 * Read through a call on purpose: after one inline check TypeScript narrows both
 * fields to `null` and keeps that narrowing across an `await`, while at runtime
 * the child can exit during exactly that wait.
 * @param child - the spawned Gateway process.
 * @returns true once it has exited or been signalled.
 */
function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

/** One plugin-owned Gateway child process. */
export class GatewayProcess {
  private child: ChildProcess | null = null

  /**
   * Start on one port and wait until the Viewer health endpoint responds.
   * @param port - the loopback port to bind.
   * @param startupTimeoutMs - how long the child has to become healthy.
   * @param probeTimeoutMs - how long each health probe may take.
   * @returns the running origin, or the failure reason and whether the port was taken.
   */
  async start(port: number, startupTimeoutMs: number, probeTimeoutMs: number): Promise<GatewayProcessStartResult> {
    const launch = gatewayLaunch(port)
    const child = spawn(launch.command, [...launch.args], launch.options)
    this.child = child
    const origin = `http://127.0.0.1:${String(port)}`
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4_000)
      if (process.env.UNIVER_DSH_GATEWAY_DEBUG === '1') process.stderr.write(chunk)
    })

    const startedAt = Date.now()
    while (Date.now() - startedAt < startupTimeoutMs) {
      if (hasExited(child)) {
        if (this.child === child) this.child = null
        const portInUse = child.exitCode === GATEWAY_PORT_IN_USE_EXIT_CODE
        const detail = stderr.trim()
        return {
          ok: false,
          reason: portInUse
            ? `Gateway port ${String(port)} is already in use`
            : detail || `bundled Gateway exited (${String(child.signalCode ?? child.exitCode ?? 'unknown')})`,
          portInUse,
        }
      }
      await new Promise<void>(resolve => setTimeout(resolve, 200))
      if (hasExited(child)) continue
      if (await gatewayIsHealthy(origin, probeTimeoutMs)) return { ok: true, gateway: origin, reused: false }
    }

    await this.stop()
    return { ok: false, reason: `bundled Gateway did not become ready within ${String(startupTimeoutMs)}ms`, portInUse: false }
  }

  /**
   * Stop only the child process this instance created.
   * @returns completion after the child has exited or been killed.
   */
  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    if (child === null || hasExited(child)) return
    const exited = new Promise<void>(resolve => child.once('exit', () => { resolve() }))
    child.kill('SIGTERM')
    await Promise.race([exited, new Promise<void>(resolve => setTimeout(resolve, 3_000))])
    if (!hasExited(child)) child.kill('SIGKILL')
  }
}
