import type { UniverService } from '../../service/univer-service.ts'

/**
 * Start or reuse the plugin-owned Gateway.
 * @param service - the Univer Provider.
 * @returns the available origin, or the reason it could not be started.
 */
export function gatewayStartRoute(service: UniverService): ReturnType<UniverService['ensureGateway']> {
  return service.ensureGateway()
}
