/**
 * App-shell service-worker registration for the web application entry.
 *
 * The worker itself is `public/sw.js` — a hand-written classic worker rather
 * than a build output, so its URL stays `/sw.js` across deployments and the
 * browser can compare byte-for-byte to decide whether an update exists.
 *
 * Registration is skipped outside a secure context because
 * `navigator.serviceWorker` is undefined there; a dsh deployment reached over
 * plain http on a LAN address therefore runs without offline support and
 * without an install prompt, which is the browser's rule, not this app's.
 */

/** Worker script path; root-scoped, so the whole origin is in scope. */
export const SERVICE_WORKER_URL = '/sw.js'

/** The browser facts registration depends on, narrowed so tests can supply them. */
export interface ServiceWorkerEnvironment {
  /** Page URL protocol (`https:`) and hostname, deciding secure-context eligibility. */
  location: { protocol: string; hostname: string }
  /** The container, absent on browsers and contexts that expose no service workers. */
  serviceWorker?: { register: (url: string) => Promise<ServiceWorkerRegistration> }
}

/**
 * Whether a hostname is one the browser treats as trustworthy over plain http.
 * @param hostname - WHATWG URL hostname (IPv6 literals retain their brackets).
 * @returns true for `localhost`, any `*.localhost` name, and IPv4/IPv6 loopback.
 */
export function isLocalhostOrigin(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
  if (hostname === '[::1]' || hostname === '::1') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
}

/**
 * Whether this page may register a worker at all.
 * @param environment - the browser facts to decide against.
 * @returns true when the context is secure and the container exists.
 */
export function serviceWorkerEligible(environment: ServiceWorkerEnvironment): boolean {
  if (environment.serviceWorker === undefined) return false
  return environment.location.protocol === 'https:' || isLocalhostOrigin(environment.location.hostname)
}

/**
 * Register the app-shell worker, if this context allows one.
 *
 * Never rejects: an install failure costs offline support, and must not take
 * the application down with it. Callers get the registration only on the
 * success path.
 * @param environment - the browser facts to decide against.
 * @returns the registration, or undefined when skipped or refused.
 */
export async function registerServiceWorker(
  environment: ServiceWorkerEnvironment,
): Promise<ServiceWorkerRegistration | undefined> {
  const container = environment.serviceWorker
  if (container === undefined || !serviceWorkerEligible(environment)) return undefined
  try {
    return await container.register(SERVICE_WORKER_URL)
  } catch (error) {
    console.warn('[dsh-web] app-shell service worker unavailable; continuing online-only:', error)
    return undefined
  }
}
