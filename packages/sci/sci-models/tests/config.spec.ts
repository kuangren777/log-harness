// The schema is the load-time guard for a VM's catalog wiring, so the defaults
// a deployment relies on and the bounds it cannot cross are pinned directly.
import { describe, expect, it } from 'vitest'
import {
  Config,
  DEFAULT_API_BASE_ENV,
  DEFAULT_API_KEY_ENV,
  DEFAULT_GATE_URL,
  DEFAULT_REFRESH_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_VM_TOKEN_ENV,
} from '../src/config.ts'

describe('the Config schema', () => {
  it('defaults every field a VM deployment does not state', () => {
    expect(Config({} as unknown as Config)).toEqual({
      gateUrl: DEFAULT_GATE_URL,
      vmTokenEnv: DEFAULT_VM_TOKEN_ENV,
      apiBaseEnv: DEFAULT_API_BASE_ENV,
      apiKeyEnv: DEFAULT_API_KEY_ENV,
      refreshMs: DEFAULT_REFRESH_MS,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      failMode: 'open',
    })
  })

  it('keeps the values a deployment does state', () => {
    expect(Config({
      gateUrl: 'https://gate.example',
      vmTokenEnv: 'OTHER_TOKEN',
      apiBaseEnv: 'OTHER_BASE',
      apiKeyEnv: 'OTHER_KEY',
      refreshMs: 60_000,
      requestTimeoutMs: 1500,
      failMode: 'closed',
    })).toMatchObject({ gateUrl: 'https://gate.example', failMode: 'closed', refreshMs: 60_000 })
  })

  it.each([
    { label: 'a refresh interval below one second', config: { refreshMs: 999 } },
    { label: 'a fractional refresh interval', config: { refreshMs: 1000.5 } },
    { label: 'a zero request timeout', config: { requestTimeoutMs: 0 } },
    { label: 'an unknown fail mode', config: { failMode: 'ajar' } },
  ])('rejects $label', ({ config }) => {
    expect(() => Config(config as unknown as Config)).toThrow()
  })
})
