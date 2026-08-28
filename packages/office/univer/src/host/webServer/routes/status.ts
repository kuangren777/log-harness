import type { UniverService } from '../../service/univer-service.ts'
import type { UniverStatus } from '../../../shared/wire/status.ts'

/**
 * Build the browser-visible plugin status.
 * @param service - the Univer Provider.
 * @returns Gateway phase and Unit content availability in one payload.
 */
export async function statusRoute(service: UniverService): Promise<UniverStatus> {
  const [gateway, unitContent] = await Promise.all([
    service.gatewayStatus(),
    service.unitContentStatus(),
  ])
  // Projected, not relayed: the service status carries the Gateway's loopback
  // origin and its failure reasons, neither of which belongs in a browser payload.
  return {
    gateway: { phase: gateway.phase, gatewayRunning: gateway.gateway !== null, owned: gateway.owned },
    unitContent,
  }
}
