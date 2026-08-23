// @vitest-environment jsdom
/**
 * Registration policy for the app-shell worker: which origins may install one,
 * and what a refused install costs. The worker's own caching rules are proved
 * against the built output in pwa-manifest.e2e.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isLocalhostOrigin, registerServiceWorker, serviceWorkerEligible, SERVICE_WORKER_URL,
} from '../src/service-worker-registration.ts'

/** A container that records what it was asked to register. */
function container(result: Promise<ServiceWorkerRegistration>) {
  return { register: vi.fn((_url: string) => result) }
}

/** The registration object identity the success paths hand back. */
const REGISTRATION = { scope: '/' } as ServiceWorkerRegistration

afterEach(() => { vi.restoreAllMocks() })

describe('isLocalhostOrigin', () => {
  it('accepts every hostname the browser trusts over plain http', () => {
    expect(isLocalhostOrigin('localhost')).toBe(true)
    expect(isLocalhostOrigin('dsh.localhost')).toBe(true)
    expect(isLocalhostOrigin('127.0.0.1')).toBe(true)
    expect(isLocalhostOrigin('127.1.2.3')).toBe(true)
    expect(isLocalhostOrigin('[::1]')).toBe(true)
    expect(isLocalhostOrigin('::1')).toBe(true)
  })

  it('rejects the ordinary and the lookalike', () => {
    expect(isLocalhostOrigin('ibd-224.bone-vector.ts.net')).toBe(false)
    expect(isLocalhostOrigin('192.168.1.20')).toBe(false)
    expect(isLocalhostOrigin('notlocalhost')).toBe(false)
    expect(isLocalhostOrigin('127.0.0.1.example.com')).toBe(false)
  })
})

describe('serviceWorkerEligible', () => {
  const swStub = { register: async () => REGISTRATION }

  it('admits https on any host, and http only on loopback', () => {
    expect(serviceWorkerEligible({ location: { protocol: 'https:', hostname: 'ibd-224.bone-vector.ts.net' }, serviceWorker: swStub })).toBe(true)
    expect(serviceWorkerEligible({ location: { protocol: 'http:', hostname: '127.0.0.1' }, serviceWorker: swStub })).toBe(true)
    expect(serviceWorkerEligible({ location: { protocol: 'http:', hostname: '192.168.1.20' }, serviceWorker: swStub })).toBe(false)
  })

  it('is false wherever the browser exposes no container', () => {
    expect(serviceWorkerEligible({ location: { protocol: 'https:', hostname: 'example.test' } })).toBe(false)
  })
})

describe('registerServiceWorker', () => {
  it('registers the root-scoped worker on an eligible origin', async () => {
    const serviceWorker = container(Promise.resolve(REGISTRATION))
    const registration = await registerServiceWorker({
      location: { protocol: 'https:', hostname: 'ibd-224.bone-vector.ts.net' },
      serviceWorker,
    })
    expect(serviceWorker.register).toHaveBeenCalledWith(SERVICE_WORKER_URL)
    expect(registration).toBe(REGISTRATION)
  })

  it('registers nothing over plain http on a LAN address', async () => {
    const serviceWorker = container(Promise.resolve(REGISTRATION))
    const registration = await registerServiceWorker({
      location: { protocol: 'http:', hostname: '192.168.1.20' },
      serviceWorker,
    })
    expect(serviceWorker.register).not.toHaveBeenCalled()
    expect(registration).toBeUndefined()
  })

  it('registers nothing when the browser exposes no container', async () => {
    const registration = await registerServiceWorker({
      location: { protocol: 'https:', hostname: 'example.test' },
    })
    expect(registration).toBeUndefined()
  })

  it('survives a refused install: offline support is lost, the application is not', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const serviceWorker = container(Promise.reject(new Error('SecurityError')))
    const registration = await registerServiceWorker({
      location: { protocol: 'https:', hostname: 'example.test' },
      serviceWorker,
    })
    expect(registration).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
  })
})
