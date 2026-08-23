/** Gate configuration: what a deployment must state and what it gets for free. */

import { describe, expect, it } from 'vitest'
import AuthGateService from '../src/index.ts'
import {
  resolveSettings, DEFAULT_CODE_TTL_MS, DEFAULT_COOKIE_NAME, DEFAULT_LINK_TTL_MS,
} from '../src/settings.ts'

describe('resolveSettings', () => {
  it('applies the same defaults whether or not Schemastery normalized them', () => {
    const normalized = new AuthGateService.Config({ baseUrl: 'https://harness.example' })
    expect(normalized).toMatchObject({ cookieSecure: true })
    expect(resolveSettings({ baseUrl: 'https://harness.example' })).toEqual({
      baseUrl: new URL('https://harness.example'),
      cookieName: DEFAULT_COOKIE_NAME,
      cookieSecure: true,
      codeTtlMs: DEFAULT_CODE_TTL_MS,
      linkTtlMs: DEFAULT_LINK_TTL_MS,
    })
  })

  it('keeps every stated value', () => {
    expect(resolveSettings({
      baseUrl: 'http://127.0.0.1:3080/',
      cookieName: 'sid',
      cookieSecure: false,
      codeTtlMs: 1,
      linkTtlMs: 2,
    })).toEqual({
      baseUrl: new URL('http://127.0.0.1:3080/'),
      cookieName: 'sid',
      cookieSecure: false,
      codeTtlMs: 1,
      linkTtlMs: 2,
    })
  })

  it('fails loudly on a base URL no mailed link could resolve against', () => {
    expect(() => resolveSettings({ baseUrl: '/relative' }))
      .toThrow('auth-gate: baseUrl "/relative" is not an absolute URL')
  })
})
